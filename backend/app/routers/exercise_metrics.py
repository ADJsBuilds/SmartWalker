"""
API for normalized exercise/vision metrics.
- Live: recent rows for the live exercise tab.
- Aggregates: daily (and optional hourly) rollups for homepage and doctor view.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.models import ExerciseMetricSample
from app.db.session import get_db

router = APIRouter(tags=['exercise-metrics'])


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
