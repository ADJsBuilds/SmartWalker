import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.models import DailyReport, MetricSample
from app.db.session import get_db
from app.services.report_pdf import build_daily_pdf
from app.services.storage import resident_report_path

router = APIRouter(tags=['reports'])


@router.post('/api/reports/daily/generate')
def generate_daily_report(residentId: str, date: str, db: Session = Depends(get_db)):
    try:
        target_date = __import__('datetime').datetime.strptime(date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail='date must be YYYY-MM-DD')

    start_ts = int(__import__('datetime').datetime.combine(target_date, __import__('datetime').time.min).timestamp())
    end_ts = int(__import__('datetime').datetime.combine(target_date, __import__('datetime').time.max).timestamp())

    samples = (
        db.query(MetricSample)
        .filter(MetricSample.resident_id == residentId, MetricSample.ts >= start_ts, MetricSample.ts <= end_ts)
        .order_by(MetricSample.ts.asc())
        .all()
    )

    steps_values = []
    cadence_values = []
    step_var_values = []
    fall_count = 0
    tilt_spikes = 0

    for s in samples:
        merged = json.loads(s.merged_json or '{}')
        metrics = merged.get('metrics') or {}
        if isinstance(metrics.get('steps'), (int, float)):
            steps_values.append(metrics['steps'])
        vision = merged.get('vision') or {}
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

    out_path = resident_report_path(residentId, date)
    build_daily_pdf(out_path, residentId, date, stats, struggles, suggestions)

    existing = db.query(DailyReport).filter(DailyReport.resident_id == residentId, DailyReport.date == target_date).first()
    if existing:
        existing.pdf_path = out_path
        existing.summary_json = json.dumps({'stats': stats, 'struggles': struggles, 'suggestions': suggestions})
        db.commit()
        db.refresh(existing)
        report = existing
    else:
        report = DailyReport(
            resident_id=residentId,
            date=target_date,
            pdf_path=out_path,
            summary_json=json.dumps({'stats': stats, 'struggles': struggles, 'suggestions': suggestions}),
        )
        db.add(report)
        db.commit()
        db.refresh(report)

    return {'pdfPath': out_path, 'reportId': report.id}


@router.get('/api/reports/daily/{report_id}/download')
def download_report(report_id: str, db: Session = Depends(get_db)):
    report = db.get(DailyReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail='report not found')
    path = Path(report.pdf_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail='report file missing')
    return FileResponse(path, media_type='application/pdf', filename=path.name)
