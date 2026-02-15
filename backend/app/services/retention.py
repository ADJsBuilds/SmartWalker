import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import DailyMetricRollup, DailyReport, ExerciseMetricSample, HourlyMetricRollup, IngestEvent, MetricSample, WalkingSession


def _utc_date_days_ago(days: int):
    now = datetime.now(tz=timezone.utc)
    return (now - timedelta(days=max(0, int(days)))).date()


def run_retention_cleanup(db: Session, settings: Settings, *, now_ts: int | None = None) -> Dict[str, Any]:
    if not settings.retention_enabled:
        return {'enabled': False, 'deleted': {}, 'run_at_ts': int(now_ts or time.time())}

    ts_now = int(now_ts or time.time())
    deleted: Dict[str, int] = {}

    metric_cutoff = ts_now - (max(0, int(settings.retention_metric_samples_days)) * 86400)
    ex_metric_cutoff = ts_now - (max(0, int(settings.retention_exercise_metric_samples_days)) * 86400)
    events_cutoff = ts_now - (max(0, int(settings.retention_ingest_events_days)) * 86400)
    walk_cutoff = ts_now - (max(0, int(settings.retention_walking_sessions_days)) * 86400)
    hourly_date_cutoff = _utc_date_days_ago(settings.retention_hourly_rollups_days)
    daily_date_cutoff = _utc_date_days_ago(settings.retention_daily_rollups_days)
    reports_date_cutoff = _utc_date_days_ago(settings.retention_daily_reports_days)

    res = db.execute(delete(MetricSample).where(MetricSample.ts < metric_cutoff))
    deleted['metric_samples'] = int(res.rowcount or 0)

    res = db.execute(delete(ExerciseMetricSample).where(ExerciseMetricSample.ts < ex_metric_cutoff))
    deleted['exercise_metric_samples'] = int(res.rowcount or 0)

    res = db.execute(delete(IngestEvent).where(IngestEvent.ts < events_cutoff))
    deleted['ingest_events'] = int(res.rowcount or 0)

    res = db.execute(
        delete(WalkingSession).where(
            WalkingSession.end_ts.is_not(None),
            WalkingSession.end_ts < walk_cutoff,
        )
    )
    deleted['walking_sessions'] = int(res.rowcount or 0)

    res = db.execute(delete(HourlyMetricRollup).where(HourlyMetricRollup.date < hourly_date_cutoff))
    deleted['hourly_metric_rollups'] = int(res.rowcount or 0)

    res = db.execute(delete(DailyMetricRollup).where(DailyMetricRollup.date < daily_date_cutoff))
    deleted['daily_metric_rollups'] = int(res.rowcount or 0)

    res = db.execute(delete(DailyReport).where(DailyReport.date < reports_date_cutoff))
    deleted['daily_reports'] = int(res.rowcount or 0)

    db.commit()
    return {
        'enabled': True,
        'run_at_ts': ts_now,
        'deleted': deleted,
        'cutoffs': {
            'metric_samples_ts': metric_cutoff,
            'exercise_metric_samples_ts': ex_metric_cutoff,
            'ingest_events_ts': events_cutoff,
            'walking_sessions_end_ts': walk_cutoff,
            'hourly_metric_rollups_date': hourly_date_cutoff.isoformat(),
            'daily_metric_rollups_date': daily_date_cutoff.isoformat(),
            'daily_reports_date': reports_date_cutoff.isoformat(),
        },
    }
