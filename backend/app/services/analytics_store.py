import json
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

from app.db.models import DailyMetricRollup, HourlyMetricRollup, IngestEvent

_EVENT_COOLDOWN_SECONDS = {
    'fall': 45,
    'near-fall': 45,
    'heavy-lean': 60,
    'inactivity': 300,
}

_last_event_ts: Dict[Tuple[str, str], int] = {}
_last_steps: Dict[str, int] = {}
_last_step_change_ts: Dict[str, int] = {}


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _bucket_start_hour(ts: int) -> int:
    return int(ts - (ts % 3600))


def _date_from_ts(ts: int):
    return datetime.fromtimestamp(ts, tz=timezone.utc).date()


def _record_event_if_due(
    db: Session,
    resident_id: str,
    event_type: str,
    ts: int,
    severity: str,
    payload: Dict[str, Any],
) -> bool:
    key = (resident_id, event_type)
    cooldown = _EVENT_COOLDOWN_SECONDS.get(event_type, 60)
    if ts - _last_event_ts.get(key, 0) < cooldown:
        return False
    _last_event_ts[key] = ts
    db.add(
        IngestEvent(
            resident_id=resident_id,
            ts=ts,
            event_type=event_type,
            severity=severity,
            payload_json=json.dumps(payload),
        )
    )
    return True


def _upsert_rollups(
    db: Session,
    resident_id: str,
    ts: int,
    *,
    steps: Optional[int],
    cadence: Optional[float],
    step_var: Optional[float],
    fall_suspected: bool,
    tilt_deg: Optional[float],
    heavy_lean_event: bool,
    inactivity_event: bool,
    active_seconds: int,
) -> None:
    day = _date_from_ts(ts)
    hour_bucket = _bucket_start_hour(ts)

    hourly = (
        db.query(HourlyMetricRollup)
        .filter(HourlyMetricRollup.resident_id == resident_id, HourlyMetricRollup.bucket_start_ts == hour_bucket)
        .first()
    )
    if not hourly:
        hourly = HourlyMetricRollup(
            resident_id=resident_id,
            bucket_start_ts=hour_bucket,
            date=day,
        )
        db.add(hourly)

    daily = db.query(DailyMetricRollup).filter(DailyMetricRollup.resident_id == resident_id, DailyMetricRollup.date == day).first()
    if not daily:
        daily = DailyMetricRollup(
            resident_id=resident_id,
            date=day,
        )
        db.add(daily)

    for row in (hourly, daily):
        row.sample_count = int(row.sample_count or 0) + 1
        row.active_seconds = int(row.active_seconds or 0) + max(0, int(active_seconds))
        if steps is not None:
            row.steps_max = max(int(row.steps_max or 0), steps)
        if cadence is not None:
            row.cadence_sum = float(row.cadence_sum or 0.0) + cadence
            row.cadence_count = int(row.cadence_count or 0) + 1
        if step_var is not None:
            row.step_var_sum = float(row.step_var_sum or 0.0) + step_var
            row.step_var_count = int(row.step_var_count or 0) + 1
        if fall_suspected:
            row.fall_count = int(row.fall_count or 0) + 1
        if tilt_deg is not None and tilt_deg >= 60:
            row.tilt_spike_count = int(row.tilt_spike_count or 0) + 1
        if heavy_lean_event:
            row.heavy_lean_count = int(row.heavy_lean_count or 0) + 1
        if inactivity_event:
            row.inactivity_count = int(row.inactivity_count or 0) + 1


def persist_analytics_tick(
    db: Session,
    resident_id: str,
    merged: Dict[str, Any],
    *,
    persist_interval_seconds: int,
) -> None:
    now_ts = int(merged.get('ts') or time.time())
    metrics = merged.get('metrics') or {}
    vision = merged.get('vision') or {}

    steps = _to_int(metrics.get('steps'))
    cadence = _to_float(vision.get('cadenceSpm'))
    step_var = _to_float(vision.get('stepVar'))
    tilt_deg = _to_float(metrics.get('tiltDeg'))
    fall_suspected = bool(metrics.get('fallSuspected'))

    prev_steps = _last_steps.get(resident_id)
    if steps is not None:
        if prev_steps is None or steps > prev_steps:
            _last_step_change_ts[resident_id] = now_ts
        _last_steps[resident_id] = steps

    inactivity_event = False
    since_step_change = now_ts - _last_step_change_ts.get(resident_id, now_ts)
    if since_step_change >= _EVENT_COOLDOWN_SECONDS['inactivity']:
        inactivity_event = _record_event_if_due(
            db,
            resident_id,
            'inactivity',
            now_ts,
            'medium',
            {'secondsWithoutStepIncrease': since_step_change},
        )

    heavy_lean_event = False
    if tilt_deg is not None and tilt_deg >= 35:
        heavy_lean_event = _record_event_if_due(
            db,
            resident_id,
            'heavy-lean',
            now_ts,
            'medium' if tilt_deg < 60 else 'high',
            {'tiltDeg': tilt_deg},
        )

    if fall_suspected:
        _record_event_if_due(
            db,
            resident_id,
            'fall',
            now_ts,
            'high',
            {'fallSuspected': True},
        )

    if tilt_deg is not None and 50 <= tilt_deg < 60:
        _record_event_if_due(
            db,
            resident_id,
            'near-fall',
            now_ts,
            'medium',
            {'tiltDeg': tilt_deg},
        )

    _upsert_rollups(
        db,
        resident_id,
        now_ts,
        steps=steps,
        cadence=cadence,
        step_var=step_var,
        fall_suspected=fall_suspected,
        tilt_deg=tilt_deg,
        heavy_lean_event=heavy_lean_event,
        inactivity_event=inactivity_event,
        active_seconds=persist_interval_seconds,
    )
