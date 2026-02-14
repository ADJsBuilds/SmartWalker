import json
import logging
from typing import Any, Dict, List, Literal, Optional

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class AtAGlanceItem(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=120)


class AlertItem(BaseModel):
    severity: Literal['low', 'medium', 'high']
    label: str = Field(min_length=1, max_length=120)
    evidence: str = Field(min_length=1, max_length=220)


class RecommendedAction(BaseModel):
    priority: Literal['P1', 'P2', 'P3']
    action: str = Field(min_length=1, max_length=180)
    why: str = Field(min_length=1, max_length=220)


class DataQuality(BaseModel):
    status: Literal['good', 'partial', 'missing']
    notes: str = Field(min_length=1, max_length=220)


class ReportNarrative(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    at_a_glance: List[AtAGlanceItem] = Field(min_length=4, max_length=6)
    alerts: List[AlertItem] = Field(default_factory=list, max_length=3)
    insights: List[str] = Field(min_length=2, max_length=4)
    recommended_actions: List[RecommendedAction] = Field(min_length=3, max_length=3)
    data_quality: DataQuality
    message_to_resident: str = Field(min_length=1, max_length=260)
    disclaimer: str = Field(min_length=1, max_length=220)


def _safe_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_json_object(raw: str) -> Optional[str]:
    text = (raw or '').strip()
    if not text:
        return None
    if text.startswith('```'):
        text = text.replace('```json', '').replace('```', '').strip()
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    return text[start : end + 1]


def build_deterministic_narrative(
    *,
    resident_id: str,
    date_str: str,
    stats: Dict[str, Any],
    struggles: List[str],
    suggestions: List[str],
    has_walker: bool,
    has_vision: bool,
) -> ReportNarrative:
    samples = int(stats.get('samples') or 0)
    steps = int(_safe_float(stats.get('steps')) or 0)
    cadence_avg = stats.get('cadenceSpm_avg')
    step_var_avg = stats.get('stepVar_avg')
    fall_count = int(stats.get('fallSuspected_count') or 0)
    tilt_spikes = int(stats.get('tilt_spikes') or 0)

    at_a_glance = [
        AtAGlanceItem(label='Samples', value=str(samples)),
        AtAGlanceItem(label='Steps', value=str(steps)),
        AtAGlanceItem(label='Cadence avg', value='-' if cadence_avg is None else str(cadence_avg)),
        AtAGlanceItem(label='Step variability avg', value='-' if step_var_avg is None else str(step_var_avg)),
        AtAGlanceItem(label='Fall-suspected count', value=str(fall_count)),
        AtAGlanceItem(label='Tilt spikes', value=str(tilt_spikes)),
    ]

    alerts: List[AlertItem] = []
    if fall_count >= 2:
        alerts.append(
            AlertItem(
                severity='high',
                label='Repeated fall-suspected events',
                evidence=f'{fall_count} events were detected in the selected day.',
            )
        )
    if tilt_spikes >= 2:
        alerts.append(
            AlertItem(
                severity='medium',
                label='Frequent tilt spikes',
                evidence=f'{tilt_spikes} tilt spikes (>=60 degrees) suggest walker control issues.',
            )
        )
    if step_var_avg is not None and _safe_float(step_var_avg) and float(step_var_avg) > 15:
        alerts.append(
            AlertItem(
                severity='medium',
                label='High gait variability',
                evidence=f'Average step variability is {step_var_avg}, above the stability threshold.',
            )
        )

    if not struggles:
        insights = [
            'No major instability pattern was detected in the available data window.',
            'Continue monitoring trends day over day to confirm sustained stability.',
        ]
    else:
        insights = struggles[:4]
        while len(insights) < 2:
            insights.append('Continue monitoring for any sudden change in gait confidence.')

    actions = suggestions[:]
    if len(actions) < 3:
        actions.append('Keep daily monitoring active and flag any repeated safety signals for follow-up.')
    if len(actions) < 3:
        actions.append('Review sensor placement and camera visibility to improve consistency of measurements.')
    actions = actions[:3]

    recommended_actions = [
        RecommendedAction(priority='P1', action=actions[0], why='Addresses highest immediate mobility and safety risks.'),
        RecommendedAction(priority='P2', action=actions[1], why='Supports consistency and quality of daily mobility practice.'),
        RecommendedAction(priority='P3', action=actions[2], why='Improves reliability of monitoring and trend interpretation.'),
    ]

    if samples == 0:
        data_quality = DataQuality(status='missing', notes='No metric samples were recorded for the selected day.')
    elif not has_walker or not has_vision:
        data_quality = DataQuality(
            status='partial',
            notes='Only one sensor stream was consistently available; interpret trends with caution.',
        )
    else:
        data_quality = DataQuality(status='good', notes='Walker and vision streams were available for this report window.')

    return ReportNarrative(
        title=f'Daily Care Report - Resident {resident_id} ({date_str})',
        at_a_glance=at_a_glance,
        alerts=alerts[:3],
        insights=insights[:4],
        recommended_actions=recommended_actions,
        data_quality=data_quality,
        message_to_resident='You are making progress. Keep your posture tall and your steps steady.',
        disclaimer='This summary is informational only and does not provide diagnosis or medication advice.',
    )


class GeminiClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _enabled(self) -> bool:
        return bool(self.settings.gemini_enabled) and bool((self.settings.gemini_api_key or '').strip())

    def _call_gemini(self, prompt: str) -> Optional[str]:
        model = (self.settings.gemini_model or 'gemini-3-flash').strip()
        base_url = (self.settings.gemini_base_url or 'https://generativelanguage.googleapis.com/v1beta').rstrip('/')
        api_key = (self.settings.gemini_api_key or '').strip()
        url = f'{base_url}/models/{model}:generateContent?key={api_key}'

        payload = {
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'generationConfig': {
                'temperature': 0.2,
                'maxOutputTokens': 700,
                'response_mime_type': 'application/json',
            },
        }

        with httpx.Client(timeout=httpx.Timeout(12.0)) as client:
            response = client.post(url, json=payload)
            response.raise_for_status()
            raw = response.json()

        candidates = raw.get('candidates', []) if isinstance(raw, dict) else []
        parts = candidates[0].get('content', {}).get('parts', []) if candidates else []
        text = parts[0].get('text') if parts and isinstance(parts[0], dict) else None
        return text.strip() if isinstance(text, str) else None

    def generate_report_narrative(self, report_input: Dict[str, Any]) -> Optional[ReportNarrative]:
        if not self._enabled():
            return None

        schema = ReportNarrative.model_json_schema()
        base_prompt = (
            "You are writing a caregiver-facing mobility report narrative.\n"
            "Use ONLY the provided input data. Do not hallucinate missing values.\n"
            "Hard constraints:\n"
            "- No medical diagnosis.\n"
            "- No medication recommendations.\n"
            "- Keep language clear and practical for caregivers.\n"
            "- Output strict JSON only.\n\n"
            f"INPUT:\n{json.dumps(report_input, indent=2)}\n\n"
            f"REQUIRED JSON SCHEMA:\n{json.dumps(schema, indent=2)}"
        )

        try:
            raw_text = self._call_gemini(base_prompt)
            json_blob = _extract_json_object(raw_text or '')
            if not json_blob:
                raise json.JSONDecodeError('No JSON object found in model output', raw_text or '', 0)
            data = json.loads(json_blob)
            return ReportNarrative.model_validate(data)
        except json.JSONDecodeError:
            try:
                retry_prompt = (
                    "Return valid JSON only. Fix formatting issues and match the schema exactly.\n"
                    f"SCHEMA:\n{json.dumps(schema, indent=2)}\n\n"
                    f"INPUT:\n{json.dumps(report_input, indent=2)}"
                )
                retry_text = self._call_gemini(retry_prompt)
                retry_blob = _extract_json_object(retry_text or '')
                if not retry_blob:
                    return None
                retry_data = json.loads(retry_blob)
                return ReportNarrative.model_validate(retry_data)
            except Exception as exc:
                logger.warning('Gemini narrative retry failed: %s', exc)
                return None
        except ValidationError as exc:
            logger.warning('Gemini narrative schema validation failed: %s', exc)
            return None
        except Exception as exc:
            logger.warning('Gemini narrative generation failed: %s', exc)
            return None
