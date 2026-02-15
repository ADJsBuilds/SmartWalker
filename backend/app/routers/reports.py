import json
from datetime import date as date_type
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.models import DailyMetricRollup, DailyReport, HourlyMetricRollup, IngestEvent, MetricSample
from app.db.session import get_db
from app.services.gemini_client import GeminiClient, build_deterministic_narrative
from app.services.report_pdf import build_daily_pdf
from app.services.storage import resident_report_path

router = APIRouter(tags=['reports'])


def _utc_day_start_ts(day: date_type) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())


def _utc_day_end_ts(day: date_type) -> int:
    return int(datetime(day.year, day.month, day.day, 23, 59, 59, 999999, tzinfo=timezone.utc).timestamp())


def _stats_from_rollup(rollup: DailyMetricRollup) -> dict:
    cadence_avg = None
    step_var_avg = None
    if rollup.cadence_count:
        cadence_avg = round(float(rollup.cadence_sum or 0.0) / int(rollup.cadence_count), 2)
    if rollup.step_var_count:
        step_var_avg = round(float(rollup.step_var_sum or 0.0) / int(rollup.step_var_count), 2)
    return {
        'samples': int(rollup.sample_count or 0),
        'steps': int(rollup.steps_max or 0),
        'cadenceSpm_avg': cadence_avg,
        'stepVar_avg': step_var_avg,
        'fallSuspected_count': int(rollup.fall_count or 0),
        'tilt_spikes': int(rollup.tilt_spike_count or 0),
    }


@router.post('/api/reports/daily/generate')
def generate_daily_report(
    residentId: str,
    date: str,
    usePlaceholder: bool = False,
    db: Session = Depends(get_db),
):
    try:
        target_date = __import__('datetime').datetime.strptime(date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail='date must be YYYY-MM-DD')

    start_ts = _utc_day_start_ts(target_date)
    end_ts = _utc_day_end_ts(target_date)

    samples = (
        db.query(MetricSample)
        .filter(MetricSample.resident_id == residentId, MetricSample.ts >= start_ts, MetricSample.ts <= end_ts)
        .order_by(MetricSample.ts.asc())
        .all()
    )

    rollup = db.query(DailyMetricRollup).filter(DailyMetricRollup.resident_id == residentId, DailyMetricRollup.date == target_date).first()

    if usePlaceholder:
        stats = {
            'samples': 48,
            'steps': 1264,
            'cadenceSpm_avg': 92.7,
            'stepVar_avg': 13.2,
            'fallSuspected_count': 1,
            'tilt_spikes': 2,
        }
        has_walker = True
        has_vision = True
        struggles = [
            'Frequent tilt spikes indicate periods of unstable walker control.',
            'Cadence dropped during afternoon sessions, suggesting fatigue.',
        ]
        suggestions = [
            'Schedule supervised gait practice focused on posture during turns.',
            'Add a brief rest break after 15 minutes of continuous walking.',
            'Reinforce cueing to keep both hands centered on the walker.',
        ]
    elif rollup and int(rollup.sample_count or 0) > 0:
        stats = _stats_from_rollup(rollup)
        has_walker = True
        has_vision = bool(rollup.cadence_count or rollup.step_var_count)
        struggles = []
        if stats['stepVar_avg'] and stats['stepVar_avg'] > 15:
            struggles.append('High step variability suggests gait instability.')
        if stats['fallSuspected_count'] >= 2:
            struggles.append('Repeated fall-suspected events detected.')
        if stats['tilt_spikes'] >= 2:
            struggles.append('Frequent tilt spikes indicate poor walker control.')
        suggestions = [
            'Review trend charts with care team and monitor daytime changes.',
            'Use supervised gait drills when instability flags are elevated.',
        ]
    else:
        steps_values = []
        cadence_values = []
        step_var_values = []
        fall_count = 0
        tilt_spikes = 0
        has_walker = False
        has_vision = False

        for s in samples:
            try:
                merged = json.loads(s.merged_json or '{}')
            except Exception:
                merged = {}
            metrics = merged.get('metrics') or {}
            if isinstance(metrics.get('steps'), (int, float)):
                steps_values.append(metrics['steps'])
            if merged.get('walker'):
                has_walker = True
            vision = merged.get('vision') or {}
            if vision:
                has_vision = True
            if isinstance(vision.get('cadenceSpm'), (int, float)):
                cadence_values.append(vision['cadenceSpm'])
            if isinstance(vision.get('stepVar'), (int, float)):
                step_var_values.append(vision['stepVar'])
            if metrics.get('fallSuspected'):
                fall_count += 1
            if isinstance(metrics.get('tiltDeg'), (int, float)) and metrics['tiltDeg'] >= 60:
                tilt_spikes += 1

        stats = {
            'samples': len(samples),
            'steps': max(steps_values) if steps_values else 0,
            'cadenceSpm_avg': round(sum(cadence_values) / len(cadence_values), 2) if cadence_values else None,
            'stepVar_avg': round(sum(step_var_values) / len(step_var_values), 2) if step_var_values else None,
            'fallSuspected_count': fall_count,
            'tilt_spikes': tilt_spikes,
        }

        struggles = []
        if stats['stepVar_avg'] and stats['stepVar_avg'] > 15:
            struggles.append('High step variability suggests gait instability.')
        if fall_count >= 2:
            struggles.append('Repeated fall-suspected events detected.')
        if tilt_spikes >= 2:
            struggles.append('Frequent tilt spikes indicate poor walker control.')

        suggestions = [
            'Schedule supervised gait practice focused on balance transitions.',
            'Review walker height/fit and reinforcement cues for posture.',
        ]

    report_input = {
        'residentId': residentId,
        'date': date,
        'samples': stats['samples'],
        'steps': stats['steps'],
        'cadenceSpm_avg': stats['cadenceSpm_avg'],
        'stepVar_avg': stats['stepVar_avg'],
        'fallSuspected_count': stats['fallSuspected_count'],
        'tilt_spikes': stats['tilt_spikes'],
        'hasVision': has_vision,
        'hasWalker': has_walker,
        'deterministic': {
            'struggles': struggles,
            'suggestions': suggestions,
        },
    }

    deterministic_narrative = build_deterministic_narrative(
        resident_id=residentId,
        date_str=date,
        stats=stats,
        struggles=struggles,
        suggestions=suggestions,
        has_walker=has_walker,
        has_vision=has_vision,
    )
    llm_narrative = GeminiClient().generate_report_narrative(report_input)
    final_narrative = llm_narrative or deterministic_narrative
    narrative_source = 'gemini' if llm_narrative else 'deterministic_fallback'

    out_path = resident_report_path(residentId, date)
    build_daily_pdf(out_path, residentId, date, stats, struggles, suggestions, final_narrative.model_dump())

    summary_payload = {
        'stats': stats,
        'struggles': struggles,
        'suggestions': suggestions,
        'usedPlaceholderData': usePlaceholder,
        'reportInput': report_input,
        'narrativeSource': narrative_source,
        'narrative': final_narrative.model_dump(),
    }

    existing = db.query(DailyReport).filter(DailyReport.resident_id == residentId, DailyReport.date == target_date).first()
    if existing:
        existing.pdf_path = out_path
        existing.summary_json = json.dumps(summary_payload)
        db.commit()
        db.refresh(existing)
        report = existing
    else:
        report = DailyReport(
            resident_id=residentId,
            date=target_date,
            pdf_path=out_path,
            summary_json=json.dumps(summary_payload),
        )
        db.add(report)
        db.commit()
        db.refresh(report)

    return {'pdfPath': out_path, 'reportId': report.id, 'usedPlaceholderData': usePlaceholder}


@router.get('/api/reports/daily/{report_id}/download')
def download_report(report_id: str, db: Session = Depends(get_db)):
    report = db.get(DailyReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail='report not found')
    path = Path(report.pdf_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail='report file missing')
    return FileResponse(
        path,
        media_type='application/pdf',
        filename=path.name,
        headers={
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
        },
    )


@router.get('/api/reports/stats')
def report_stats(residentId: str, days: int = 7, db: Session = Depends(get_db)):
    days = max(1, min(days, 30))
    end_day = datetime.utcnow().date()
    start_day = end_day - timedelta(days=days - 1)
    start_ts = _utc_day_start_ts(start_day)

    daily_rows = (
        db.query(DailyMetricRollup)
        .filter(DailyMetricRollup.resident_id == residentId, DailyMetricRollup.date >= start_day, DailyMetricRollup.date <= end_day)
        .order_by(DailyMetricRollup.date.asc())
        .all()
    )
    hourly_rows = (
        db.query(HourlyMetricRollup)
        .filter(HourlyMetricRollup.resident_id == residentId, HourlyMetricRollup.bucket_start_ts >= start_ts)
        .order_by(HourlyMetricRollup.bucket_start_ts.asc())
        .all()
    )
    event_rows = (
        db.query(IngestEvent)
        .filter(IngestEvent.resident_id == residentId, IngestEvent.ts >= start_ts)
        .order_by(IngestEvent.ts.desc())
        .limit(100)
        .all()
    )

    def _daily_item(row: DailyMetricRollup) -> dict:
        cadence_avg = None
        step_var_avg = None
        if row.cadence_count:
            cadence_avg = round(float(row.cadence_sum or 0.0) / int(row.cadence_count), 2)
        if row.step_var_count:
            step_var_avg = round(float(row.step_var_sum or 0.0) / int(row.step_var_count), 2)
        return {
            'date': row.date.isoformat(),
            'samples': int(row.sample_count or 0),
            'steps': int(row.steps_max or 0),
            'cadenceSpm_avg': cadence_avg,
            'stepVar_avg': step_var_avg,
            'fallSuspected_count': int(row.fall_count or 0),
            'tilt_spikes': int(row.tilt_spike_count or 0),
            'heavy_lean_count': int(row.heavy_lean_count or 0),
            'inactivity_count': int(row.inactivity_count or 0),
            'active_seconds': int(row.active_seconds or 0),
        }

    def _hourly_item(row: HourlyMetricRollup) -> dict:
        cadence_avg = None
        step_var_avg = None
        if row.cadence_count:
            cadence_avg = round(float(row.cadence_sum or 0.0) / int(row.cadence_count), 2)
        if row.step_var_count:
            step_var_avg = round(float(row.step_var_sum or 0.0) / int(row.step_var_count), 2)
        return {
            'bucketStartTs': int(row.bucket_start_ts),
            'samples': int(row.sample_count or 0),
            'steps': int(row.steps_max or 0),
            'cadenceSpm_avg': cadence_avg,
            'stepVar_avg': step_var_avg,
            'fallSuspected_count': int(row.fall_count or 0),
            'tilt_spikes': int(row.tilt_spike_count or 0),
            'heavy_lean_count': int(row.heavy_lean_count or 0),
            'inactivity_count': int(row.inactivity_count or 0),
            'active_seconds': int(row.active_seconds or 0),
        }

    return {
        'residentId': residentId,
        'windowDays': days,
        'daily': [_daily_item(row) for row in daily_rows],
        'hourly': [_hourly_item(row) for row in hourly_rows],
        'events': [
            {
                'id': row.id,
                'ts': row.ts,
                'eventType': row.event_type,
                'severity': row.severity,
                'payload': json.loads(row.payload_json or '{}'),
            }
            for row in event_rows
        ],
    }


@router.post('/api/reports/rollups/backfill')
def backfill_rollups(residentId: str, days: int = 7, db: Session = Depends(get_db)):
    days = max(1, min(days, 60))
    end_day = datetime.utcnow().date()
    start_day = end_day - timedelta(days=days - 1)
    start_ts = _utc_day_start_ts(start_day)
    end_ts = _utc_day_end_ts(end_day)

    samples = (
        db.query(MetricSample)
        .filter(MetricSample.resident_id == residentId, MetricSample.ts >= start_ts, MetricSample.ts <= end_ts)
        .order_by(MetricSample.ts.asc())
        .all()
    )
    if not samples:
        return {'ok': True, 'processed': 0}

    touched_daily: set[date_type] = set()
    touched_hourly: set[int] = set()
    daily_cache: dict[date_type, DailyMetricRollup] = {}
    hourly_cache: dict[int, HourlyMetricRollup] = {}
    for s in samples:
        try:
            merged = json.loads(s.merged_json or '{}')
        except Exception:
            merged = {}
        metrics = merged.get('metrics') or {}
        vision = merged.get('vision') or {}
        ts = int(merged.get('ts') or s.ts)
        day = datetime.utcfromtimestamp(ts).date()
        hour_bucket = ts - (ts % 3600)
        touched_daily.add(day)
        touched_hourly.add(hour_bucket)

        daily_row = daily_cache.get(day)
        if not daily_row:
            daily_row = (
                db.query(DailyMetricRollup)
                .filter(DailyMetricRollup.resident_id == residentId, DailyMetricRollup.date == day)
                .first()
            )
            if not daily_row:
                daily_row = DailyMetricRollup(resident_id=residentId, date=day)
                db.add(daily_row)
            daily_cache[day] = daily_row

        hourly_row = hourly_cache.get(hour_bucket)
        if not hourly_row:
            hourly_row = (
                db.query(HourlyMetricRollup)
                .filter(HourlyMetricRollup.resident_id == residentId, HourlyMetricRollup.bucket_start_ts == hour_bucket)
                .first()
            )
            if not hourly_row:
                hourly_row = HourlyMetricRollup(resident_id=residentId, bucket_start_ts=hour_bucket, date=day)
                db.add(hourly_row)
            hourly_cache[hour_bucket] = hourly_row

        for row in (daily_row, hourly_row):
            row.sample_count = int(row.sample_count or 0) + 1
            step_value = metrics.get('steps')
            if isinstance(step_value, (int, float)):
                row.steps_max = max(int(row.steps_max or 0), int(step_value))
            cadence = vision.get('cadenceSpm')
            if isinstance(cadence, (int, float)):
                row.cadence_sum = float(row.cadence_sum or 0.0) + float(cadence)
                row.cadence_count = int(row.cadence_count or 0) + 1
            step_var = vision.get('stepVar')
            if isinstance(step_var, (int, float)):
                row.step_var_sum = float(row.step_var_sum or 0.0) + float(step_var)
                row.step_var_count = int(row.step_var_count or 0) + 1
            if metrics.get('fallSuspected'):
                row.fall_count = int(row.fall_count or 0) + 1
            tilt = metrics.get('tiltDeg')
            if isinstance(tilt, (int, float)) and float(tilt) >= 60:
                row.tilt_spike_count = int(row.tilt_spike_count or 0) + 1
            row.active_seconds = int(row.active_seconds or 0) + 1

    db.commit()
    return {'ok': True, 'processed': len(samples), 'dailyBucketsTouched': len(touched_daily), 'hourlyBucketsTouched': len(touched_hourly)}
