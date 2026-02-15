import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Optional

from app.db.models import ExerciseMetricSample


_INTENT_PROGRESS_SUMMARY = 'progress_summary'
_INTENT_STATUS_CHECK = 'status_check'
_INTENT_IMPROVEMENT_ADVICE = 'improvement_advice'
_INTENT_GENERAL = 'general'


@dataclass(frozen=True)
class ExerciseQnaContextResult:
    payload: dict[str, Any]
    latest_ts: Optional[int]


def classify_question_intent(question: str) -> str:
    text = (question or '').strip().lower()
    if not text:
        return _INTENT_GENERAL
    compact = re.sub(r'[^a-z0-9\s]', ' ', text)
    compact = re.sub(r'\s+', ' ', compact).strip()

    if any(token in compact for token in ('improve', 'better', 'recommend', 'advice', 'work on')):
        return _INTENT_IMPROVEMENT_ADVICE
    if any(token in compact for token in ('summary', 'summarize', 'recent progress', 'trend', 'progress')):
        return _INTENT_PROGRESS_SUMMARY
    if any(token in compact for token in ('how am i doing', 'how i am doing', 'how are things', 'status', 'doing')):
        return _INTENT_STATUS_CHECK
    return _INTENT_GENERAL


def build_exercise_qna_context(
    *,
    resident_id: str,
    question: str,
    rows: list[ExerciseMetricSample],
    max_samples: int,
) -> ExerciseQnaContextResult:
    started = perf_counter()
    intent = classify_question_intent(question)
    latest_row = rows[0] if rows else None
    latest_ts = int(latest_row.ts) if latest_row else None
    stale_data = _is_stale(latest_ts)

    steps = _series(rows, selector=_step_value)
    cadence = _series(rows, selector=lambda r: _to_float(r.cadence_spm))
    tilt = _series(rows, selector=lambda r: _to_float(r.tilt_deg))
    step_var = _series(rows, selector=lambda r: _to_float(r.step_var))
    posture_top = _top_posture(rows)
    fall_count = sum(1 for r in rows if bool(r.fall_suspected))
    high_tilt_count = sum(1 for r in rows if _to_float(r.tilt_deg) is not None and float(r.tilt_deg) >= 35.0)

    step_delta = _delta(steps)
    cadence_delta = _delta(cadence)
    cadence_avg = _avg(cadence)
    tilt_avg = _avg(tilt)
    tilt_max = round(max(tilt), 2) if tilt else None
    step_var_avg = _avg(step_var)

    recommendations = _build_recommendations(
        step_delta=step_delta,
        cadence_avg=cadence_avg,
        tilt_avg=tilt_avg,
        high_tilt_count=high_tilt_count,
        fall_count=fall_count,
    )
    grounding_text = _build_grounding_text(
        intent=intent,
        question=question,
        rows_used=len(rows),
        max_samples=max_samples,
        steps=steps,
        step_delta=step_delta,
        cadence_avg=cadence_avg,
        cadence_delta=cadence_delta,
        tilt_avg=tilt_avg,
        tilt_max=tilt_max,
        step_var_avg=step_var_avg,
        fall_count=fall_count,
        high_tilt_count=high_tilt_count,
        posture_top=posture_top,
        stale_data=stale_data,
    )

    payload = {
        'residentId': resident_id,
        'question': question,
        'intent': intent,
        'rowsUsed': len(rows),
        'requestedSamples': max_samples,
        'windowStartTs': int(rows[-1].ts) if rows else None,
        'windowEndTs': int(rows[0].ts) if rows else None,
        'latestTs': latest_ts,
        'staleDataFlag': stale_data,
        'metrics': {
            'stepDelta': step_delta,
            'cadenceAvg': cadence_avg,
            'cadenceDelta': cadence_delta,
            'tiltAvg': tilt_avg,
            'tiltMax': tilt_max,
            'stepVarAvg': step_var_avg,
            'fallSuspectedCount': fall_count,
            'highTiltCount': high_tilt_count,
            'postureTop': posture_top,
        },
        'groundingText': grounding_text,
        'recommendedFocus': recommendations,
        'contextBuildMs': max(1, int((perf_counter() - started) * 1000)),
    }
    return ExerciseQnaContextResult(payload=payload, latest_ts=latest_ts)


def _build_grounding_text(
    *,
    intent: str,
    question: str,
    rows_used: int,
    max_samples: int,
    steps: list[float],
    step_delta: Optional[float],
    cadence_avg: Optional[float],
    cadence_delta: Optional[float],
    tilt_avg: Optional[float],
    tilt_max: Optional[float],
    step_var_avg: Optional[float],
    fall_count: int,
    high_tilt_count: int,
    posture_top: Optional[str],
    stale_data: bool,
) -> str:
    if rows_used == 0:
        return (
            "No recent exercise samples are available. "
            "Acknowledge missing data and ask the user to continue walking to collect more signals."
        )

    lines = [f"Question intent: {intent}.", f"Use only facts from the latest {rows_used}/{max_samples} exercise samples."]
    if step_delta is not None:
        direction = 'up' if step_delta >= 0 else 'down'
        lines.append(f"Steps trend: {direction} by {int(step_delta)} over this window.")
    if cadence_avg is not None:
        cadence_text = f"Cadence avg: {cadence_avg:.1f} spm"
        if cadence_delta is not None:
            cadence_text += f", change {cadence_delta:+.1f}"
        lines.append(cadence_text + ".")
    if tilt_avg is not None:
        tilt_text = f"Tilt avg: {tilt_avg:.2f} deg"
        if tilt_max is not None:
            tilt_text += f", max {tilt_max:.2f}"
        lines.append(tilt_text + ".")
    if step_var_avg is not None:
        lines.append(f"Step variability avg: {step_var_avg:.2f}.")
    lines.append(f"Safety: fall-suspected samples={fall_count}, high-tilt samples={high_tilt_count}.")
    if posture_top:
        lines.append(f"Most common posture: {posture_top}.")
    if stale_data:
        lines.append("Data freshness warning: latest sample is stale.")

    q = (question or '').strip()
    if q:
        lines.append(f"User question: {q}")
    return ' '.join(lines)


def _build_recommendations(
    *,
    step_delta: Optional[float],
    cadence_avg: Optional[float],
    tilt_avg: Optional[float],
    high_tilt_count: int,
    fall_count: int,
) -> list[str]:
    recs: list[str] = []
    if step_delta is not None and step_delta < 10:
        recs.append('Increase consistent movement in short intervals to lift total steps.')
    if cadence_avg is not None and cadence_avg < 80:
        recs.append('Aim for a steadier pace to gradually increase cadence.')
    if tilt_avg is not None and tilt_avg >= 8:
        recs.append('Focus on upright posture and controlled turns to reduce lean angle.')
    if high_tilt_count > 0 or fall_count > 0:
        recs.append('Prioritize safety: shorten stride and use support when balance feels uncertain.')
    if not recs:
        recs.append('Maintain your current pace and posture consistency.')
    return recs[:3]


def _step_value(row: ExerciseMetricSample) -> Optional[float]:
    if row.steps_merged is not None:
        return float(row.steps_merged)
    if row.step_count is not None:
        return float(row.step_count)
    return None


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return None
        return number
    except (TypeError, ValueError):
        return None


def _series(rows: list[ExerciseMetricSample], selector) -> list[float]:
    values: list[float] = []
    # Convert to chronological order for trend calculations.
    for row in reversed(rows):
        value = selector(row)
        if value is not None:
            values.append(float(value))
    return values


def _delta(values: list[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    return round(values[-1] - values[0], 2)


def _avg(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _top_posture(rows: list[ExerciseMetricSample]) -> Optional[str]:
    postures = [str(r.posture_state) for r in rows if r.posture_state]
    if not postures:
        return None
    return Counter(postures).most_common(1)[0][0]


def _is_stale(latest_ts: Optional[int]) -> bool:
    if latest_ts is None:
        return True
    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    return (now_ts - int(latest_ts)) > 20
