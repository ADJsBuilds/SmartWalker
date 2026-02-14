from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.models import DailyMetricRollup
from app.db.session import get_db
from app.services.gemini_client import GeminiClient

router = APIRouter(tags=['suggestions'])


def _build_stats_summary(daily_rows: list, resident_id: str, days: int) -> str:
    if not daily_rows:
        return f"Resident {resident_id}: No daily rollup data for the last {days} days."

    total_samples = sum(int(r.sample_count or 0) for r in daily_rows)
    max_steps = max(int(r.steps_max or 0) for r in daily_rows) if daily_rows else 0
    total_falls = sum(int(r.fall_count or 0) for r in daily_rows)
    total_tilt = sum(int(r.tilt_spike_count or 0) for r in daily_rows)
    cadence_vals = []
    step_var_vals = []
    for r in daily_rows:
        if r.cadence_count:
            cadence_vals.append(float(r.cadence_sum or 0) / int(r.cadence_count))
        if r.step_var_count:
            step_var_vals.append(float(r.step_var_sum or 0) / int(r.step_var_count))
    cadence_avg = round(sum(cadence_vals) / len(cadence_vals), 2) if cadence_vals else None
    step_var_avg = round(sum(step_var_vals) / len(step_var_vals), 2) if step_var_vals else None

    parts = [
        f"Resident {resident_id}, last {days} days:",
        f"Total metric samples: {total_samples}.",
        f"Max steps in a day: {max_steps}.",
        f"Fall-suspected events: {total_falls}.",
        f"Tilt spikes (>=60 deg): {total_tilt}.",
    ]
    if cadence_avg is not None:
        parts.append(f"Average cadence (steps/min): {cadence_avg}.")
    if step_var_avg is not None:
        parts.append(f"Average step variability: {step_var_avg}.")
    return " ".join(parts)


def _deterministic_fallback(daily_rows: list) -> list[str]:
    if not daily_rows:
        return [
            "Start with short supervised walks to establish a baseline.",
            "Focus on keeping both hands on the walker and upright posture.",
            "Schedule a follow-up with your physical therapist to set goals.",
        ]
    total_falls = sum(int(r.fall_count or 0) for r in daily_rows)
    total_tilt = sum(int(r.tilt_spike_count or 0) for r in daily_rows)
    suggestions = []
    if total_falls >= 2:
        suggestions.append("Schedule supervised gait practice to address fall-risk signals.")
    if total_tilt >= 2:
        suggestions.append("Focus on balance and keeping the walker level during turns.")
    suggestions.append("Aim for consistent daily walking time to build endurance.")
    suggestions.append("Review walker height and hand placement with your PT.")
    return suggestions[:5]


@router.get('/api/suggestions/exercise-regimen')
def get_exercise_regimen_suggestions(
    residentId: str,
    days: int = 7,
    db: Session = Depends(get_db),
):
    days = max(1, min(days, 30))
    end_day = datetime.utcnow().date()
    start_day = end_day - timedelta(days=days - 1)

    daily_rows = (
        db.query(DailyMetricRollup)
        .filter(
            DailyMetricRollup.resident_id == residentId,
            DailyMetricRollup.date >= start_day,
            DailyMetricRollup.date <= end_day,
        )
        .order_by(DailyMetricRollup.date.asc())
        .all()
    )

    summary = _build_stats_summary(daily_rows, residentId, days)
    gemini = GeminiClient()
    suggestions = gemini.generate_exercise_suggestions(summary, days)
    if not suggestions:
        suggestions = _deterministic_fallback(daily_rows)

    return {'suggestions': suggestions}
