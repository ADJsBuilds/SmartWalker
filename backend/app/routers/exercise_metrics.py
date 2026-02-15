"""
API for normalized exercise/vision metrics.
- Live: recent rows for the live exercise tab.
- Aggregates: daily (and optional hourly) rollups for homepage and doctor view.
"""
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import ExerciseMetricSample, IngestEvent
from app.db.session import get_db

router = APIRouter(tags=['exercise-metrics'])
_GOAL_STEPS = 1000
_CONTEXT_TTL_SECONDS = 2.0
_CONTEXT_TEXT_MAX_CHARS = 800
_context_cache_lock = threading.Lock()
_context_cache: dict[tuple[str, int, int], tuple[float, dict[str, Any]]] = {}


def _row_to_live_item(row: ExerciseMetricSample) -> dict[str, Any]:
    """Map DB row to camelCase API response for live dashboard."""
    return {
        'id': row.id,
        'residentId': row.resident_id,
        'cameraId': row.camera_id,
        'ts': row.ts,
        'fallSuspected': bool(row.fall_suspected),
        'fallCount': row.fall_count,
        'totalTimeOnGroundSeconds': row.total_time_on_ground_seconds,
        'postureState': row.posture_state,
        'stepCount': row.step_count,
        'cadenceSpm': row.cadence_spm,
        'avgCadenceSpm': row.avg_cadence_spm,
        'stepTimeCv': row.step_time_cv,
        'stepTimeMean': row.step_time_mean,
        'activityState': row.activity_state,
        'asymmetryIndex': row.asymmetry_index,
        'fallRiskLevel': row.fall_risk_level,
        'fallRiskScore': row.fall_risk_score,
        'fogStatus': row.fog_status,
        'fogEpisodes': row.fog_episodes,
        'fogDurationSeconds': row.fog_duration_seconds,
        'personDetected': row.person_detected,
        'confidence': row.confidence,
        'sourceFps': row.source_fps,
        'frameId': row.frame_id,
        'steps': row.steps_merged,
        'tiltDeg': row.tilt_deg,
        'stepVar': row.step_var,
        'createdAt': row.created_at.isoformat() if row.created_at else None,
    }


def _step_value(row: ExerciseMetricSample) -> Optional[int]:
    if row.steps_merged is not None:
        return int(row.steps_merged)
    if row.step_count is not None:
        return int(row.step_count)
    return None


def _safe_avg(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _clip_text(text: str, max_chars: int = _CONTEXT_TEXT_MAX_CHARS) -> str:
    clean = ' '.join((text or '').split())
    if len(clean) <= max_chars:
        return clean
    return clean[: max_chars - 1].rstrip() + '…'


def _build_context_summary(resident_id: str, rows: list[ExerciseMetricSample], recent_events: list[IngestEvent]) -> dict[str, Any]:
    latest = rows[0] if rows else None
    current_step = _step_value(latest) if latest else None
    current_ts = int(latest.ts) if latest else None
    goal_steps = _GOAL_STEPS
    steps_remaining = max(0, goal_steps - int(current_step or 0))
    goal_progress_pct = round((int(current_step or 0) / goal_steps) * 100.0, 1) if goal_steps > 0 else 0.0

    cadence_values = [float(r.cadence_spm) for r in rows if r.cadence_spm is not None]
    tilt_values = [float(r.tilt_deg) for r in rows if r.tilt_deg is not None]
    posture_counts = Counter([str(r.posture_state) for r in rows if r.posture_state])
    posture_top = posture_counts.most_common(1)[0][0] if posture_counts else None
    fall_suspected_count = sum(1 for r in rows if bool(r.fall_suspected))
    cadence_avg = _safe_avg(cadence_values)
    cadence_delta = round(cadence_values[0] - cadence_values[-1], 2) if len(cadence_values) >= 2 else None
    tilt_avg = _safe_avg(tilt_values)
    tilt_max = round(max(tilt_values), 2) if tilt_values else None
    window_sample_count = len(rows)
    window_start_ts = int(rows[-1].ts) if rows else None
    window_end_ts = int(rows[0].ts) if rows else None

    event_items = [
        {
            'ts': int(ev.ts),
            'eventType': ev.event_type,
            'severity': ev.severity,
        }
        for ev in recent_events
    ]
    event_text = ', '.join([f"{e['eventType']}({e['severity']})@{e['ts']}" for e in event_items]) if event_items else 'none'
    prompt_text = _clip_text(
        (
            f"Live gait context for resident {resident_id}: "
            f"steps {int(current_step or 0)}/{goal_steps} ({goal_progress_pct}%), remaining {steps_remaining}. "
            f"Window samples {window_sample_count}"
            + (f" from {window_start_ts} to {window_end_ts}. " if window_start_ts and window_end_ts else '. ')
            + (
                f"Cadence avg {cadence_avg}"
                + (f" (delta {cadence_delta:+.2f}). " if cadence_delta is not None else '. ')
                if cadence_avg is not None
                else ''
            )
            + (
                f"Tilt avg {tilt_avg}, max {tilt_max}. " if tilt_avg is not None and tilt_max is not None else ''
            )
            + f"Fall-suspected samples {fall_suspected_count}. "
            + (f"Top posture {posture_top}. " if posture_top else '')
            + f"Recent events: {event_text}."
        )
    )

    return {
        'residentId': resident_id,
        'currentTs': current_ts,
        'currentStep': current_step,
        'goalSteps': goal_steps,
        'stepsRemaining': steps_remaining,
        'goalProgressPct': goal_progress_pct,
        'windowSampleCount': window_sample_count,
        'windowStartTs': window_start_ts,
        'windowEndTs': window_end_ts,
        'cadenceAvg': cadence_avg,
        'cadenceDelta': cadence_delta,
        'tiltAvg': tilt_avg,
        'tiltMax': tilt_max,
        'fallSuspectedCount': fall_suspected_count,
        'postureTop': posture_top,
        'recentEvents': event_items,
        'promptText': prompt_text,
    }


@router.get('/api/exercise-metrics/live')
def get_live_metrics(
    residentId: str = Query(..., description='Resident id, e.g. r1'),
    limit: int = Query(100, ge=1, le=500, description='Max rows to return'),
    sinceTs: Optional[int] = Query(None, description='Only return rows with ts >= this (Unix seconds)'),
    db: Session = Depends(get_db),
):
    """
    Recent normalized metric rows for the live exercise tab.
    Ordered by ts descending (newest first).
    """
    q = (
        db.query(ExerciseMetricSample)
        .filter(ExerciseMetricSample.resident_id == residentId)
    )
    if sinceTs is not None:
        q = q.filter(ExerciseMetricSample.ts >= sinceTs)
    rows = (
        q.order_by(ExerciseMetricSample.ts.desc())
        .limit(limit)
        .all()
    )
    return {
        'residentId': residentId,
        'samples': [_row_to_live_item(r) for r in rows],
    }


@router.get('/api/exercise-metrics/context-window')
def get_context_window(
    residentId: str = Query(..., description='Resident id, e.g. r1'),
    maxSamples: int = Query(50, ge=1, le=100, description='Maximum rows in the returned context window'),
    stepWindow: int = Query(50, ge=1, le=500, description='Step window (currentStep-stepWindow..currentStep)'),
    db: Session = Depends(get_db),
):
    cache_key = (residentId, maxSamples, stepWindow)
    now_mono = time.monotonic()
    with _context_cache_lock:
        cached = _context_cache.get(cache_key)
        if cached and now_mono - cached[0] < _CONTEXT_TTL_SECONDS:
            return cached[1]

    latest_row = (
        db.query(ExerciseMetricSample)
        .filter(ExerciseMetricSample.resident_id == residentId)
        .order_by(ExerciseMetricSample.ts.desc())
        .first()
    )
    if latest_row is None:
        payload = {
            'residentId': residentId,
            'currentTs': None,
            'currentStep': None,
            'goalSteps': _GOAL_STEPS,
            'stepsRemaining': _GOAL_STEPS,
            'goalProgressPct': 0.0,
            'windowSampleCount': 0,
            'cadenceAvg': None,
            'cadenceDelta': None,
            'tiltAvg': None,
            'tiltMax': None,
            'fallSuspectedCount': 0,
            'postureTop': None,
            'recentEvents': [],
            'promptText': f'Live gait context unavailable for resident {residentId}; no recent exercise samples.',
        }
        with _context_cache_lock:
            _context_cache[cache_key] = (now_mono, payload)
        return payload

    current_step = _step_value(latest_row)
    rows: list[ExerciseMetricSample]
    if current_step is not None:
        lower_bound = max(0, int(current_step) - int(stepWindow))
        step_expr = func.coalesce(ExerciseMetricSample.steps_merged, ExerciseMetricSample.step_count)
        rows = (
            db.query(ExerciseMetricSample)
            .filter(
                ExerciseMetricSample.resident_id == residentId,
                step_expr >= lower_bound,
                step_expr <= int(current_step),
            )
            .order_by(ExerciseMetricSample.ts.desc())
            .limit(maxSamples)
            .all()
        )
    else:
        rows = []

    if not rows:
        rows = (
            db.query(ExerciseMetricSample)
            .filter(ExerciseMetricSample.resident_id == residentId)
            .order_by(ExerciseMetricSample.ts.desc())
            .limit(maxSamples)
            .all()
        )

    min_ts = int(rows[-1].ts) if rows else int(latest_row.ts)
    max_ts = int(rows[0].ts) if rows else int(latest_row.ts)
    recent_events = (
        db.query(IngestEvent)
        .filter(
            IngestEvent.resident_id == residentId,
            IngestEvent.ts >= min_ts,
            IngestEvent.ts <= max_ts,
        )
        .order_by(IngestEvent.ts.desc())
        .limit(3)
        .all()
    )

    payload = _build_context_summary(residentId, rows, recent_events)
    with _context_cache_lock:
        _context_cache[cache_key] = (now_mono, payload)
    return payload


@router.get('/api/exercise-metrics/aggregates')
def get_aggregates(
    residentId: str = Query(..., description='Resident id'),
    days: int = Query(7, ge=1, le=90, description='Number of days of history'),
    db: Session = Depends(get_db),
):
    """
    Daily aggregates from exercise_metric_samples for homepage and doctor view.
    Returns one entry per day with steps_max, fall_count, cadence/step_var averages, etc.
    """
    tz = timezone.utc
    end_day = datetime.now(tz=tz).date()
    start_day = end_day - timedelta(days=days - 1)
    start_ts = int(datetime.combine(start_day, datetime.min.time(), tzinfo=tz).timestamp())
    end_ts = int(datetime.combine(end_day, datetime.max.time(), tzinfo=tz).timestamp())

    # Daily aggregates from normalized table (SQLite: use date(ts, 'unixepoch') for day)
    # For portability we filter by ts and group in Python, or use raw SQL date extraction.
    rows = (
        db.query(ExerciseMetricSample)
        .filter(
            ExerciseMetricSample.resident_id == residentId,
            ExerciseMetricSample.ts >= start_ts,
            ExerciseMetricSample.ts <= end_ts,
        )
        .order_by(ExerciseMetricSample.ts.asc())
        .all()
    )

    # Group by date
    daily: dict[str, dict[str, Any]] = {}
    for r in rows:
        day_str = datetime.utcfromtimestamp(r.ts).date().isoformat()
        if day_str not in daily:
            daily[day_str] = {
                'date': day_str,
                'samples': 0,
                'steps_max': 0,
                'fall_count': 0,
                'cadence_sum': 0.0,
                'cadence_count': 0,
                'step_var_sum': 0.0,
                'step_var_count': 0,
                'fog_episodes_total': 0,
                'fog_duration_seconds_total': 0.0,
            }
        d = daily[day_str]
        d['samples'] += 1
        if (r.steps_merged or r.step_count) is not None:
            d['steps_max'] = max(d['steps_max'], r.steps_merged or r.step_count or 0)
        if r.fall_suspected:
            d['fall_count'] += 1
        if r.cadence_spm is not None:
            d['cadence_sum'] += r.cadence_spm
            d['cadence_count'] += 1
        if r.step_var is not None:
            d['step_var_sum'] += r.step_var
            d['step_var_count'] += 1
        if r.fog_episodes is not None:
            d['fog_episodes_total'] += r.fog_episodes
        if r.fog_duration_seconds is not None:
            d['fog_duration_seconds_total'] += r.fog_duration_seconds

    result = []
    for date_key in sorted(daily.keys()):
        d = daily[date_key]
        cadence_avg = round(d['cadence_sum'] / d['cadence_count'], 2) if d['cadence_count'] else None
        step_var_avg = round(d['step_var_sum'] / d['step_var_count'], 2) if d['step_var_count'] else None
        result.append({
            'date': d['date'],
            'samples': d['samples'],
            'steps': d['steps_max'],
            'cadenceSpm_avg': cadence_avg,
            'stepVar_avg': step_var_avg,
            'fallSuspected_count': d['fall_count'],
            'fogEpisodesTotal': d['fog_episodes_total'],
            'fogDurationSecondsTotal': round(d['fog_duration_seconds_total'], 2),
        })

    return {
        'residentId': residentId,
        'windowDays': days,
        'daily': result,
    }


@router.get('/api/exercise-metrics/summary')
def get_summary(
    residentId: str = Query(..., description='Resident id'),
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """
    Single summary object for homepage/doctor: totals and recent activity.
    """
    tz = timezone.utc
    end_ts = int(datetime.now(tz=tz).timestamp())
    start_ts = end_ts - (days * 86400)

    rows = (
        db.query(ExerciseMetricSample)
        .filter(
            ExerciseMetricSample.resident_id == residentId,
            ExerciseMetricSample.ts >= start_ts,
        )
        .all()
    )

    total_steps = 0
    steps_max_single = 0
    fall_count = 0
    cadence_sum = 0.0
    cadence_n = 0
    fog_episodes = 0
    fog_duration = 0.0
    for r in rows:
        s = r.steps_merged or r.step_count or 0
        total_steps += s
        steps_max_single = max(steps_max_single, s)
        if r.fall_suspected:
            fall_count += 1
        if r.cadence_spm is not None:
            cadence_sum += r.cadence_spm
            cadence_n += 1
        if r.fog_episodes is not None:
            fog_episodes += r.fog_episodes
        if r.fog_duration_seconds is not None:
            fog_duration += r.fog_duration_seconds

    return {
        'residentId': residentId,
        'windowDays': days,
        'sampleCount': len(rows),
        'stepsTotal': total_steps,
        'stepsMaxSingle': steps_max_single,
        'fallSuspectedCount': fall_count,
        'cadenceSpmAvg': round(cadence_sum / cadence_n, 2) if cadence_n else None,
        'fogEpisodesTotal': fog_episodes,
        'fogDurationSecondsTotal': round(fog_duration, 2),
    }
