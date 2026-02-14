import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_COOLDOWN_STATE: Dict[str, Dict[str, Any]] = {}


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _trim_script(text: str, max_chars: int = 220) -> str:
    cleaned = re.sub(r'\s+', ' ', text or '').strip()
    if not cleaned:
        return ''
    sentences = re.split(r'(?<=[.!?])\s+', cleaned)
    clipped = ' '.join(sentences[:2]).strip()
    if len(clipped) <= max_chars:
        return clipped
    return clipped[: max_chars - 1].rstrip() + '.'


def _remove_diagnostic_language(text: str) -> str:
    unsafe_terms = ['diagnose', 'diagnosis', 'disease', 'disorder', 'prescription', 'medication']
    safe = text
    for term in unsafe_terms:
        safe = re.sub(rf'\b{term}\b', 'health', safe, flags=re.IGNORECASE)
    return safe


def _apply_cooldown(key: str, script: str, cooldown_seconds: int) -> str:
    now = time.time()
    prior = _COOLDOWN_STATE.get(key)
    if prior and prior.get('script') == script and (now - float(prior.get('ts', 0.0))) < cooldown_seconds:
        # Small variation to avoid repetitive cadence while preserving intent.
        if script.endswith('.'):
            varied = script[:-1] + ', keep it steady.'
        else:
            varied = script + ' Keep it steady.'
        script = _trim_script(varied)
    _COOLDOWN_STATE[key] = {'script': script, 'ts': now}
    return script


class CoachScriptService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _rules_first(
        self,
        *,
        resident_id: str,
        context: Dict[str, Any],
        goal: str,
        tone: str,
        user_prompt: Optional[str],
    ) -> Tuple[str, str, List[str], Dict[str, Any]]:
        steps = int(_to_float(context.get('steps')))
        tilt_deg = _to_float(context.get('tiltDeg'))
        cadence = _to_float(context.get('cadence'))
        balance = _to_float(context.get('balance'))
        fall_suspected = bool(context.get('fallSuspected'))
        session_phase = str(context.get('sessionPhase') or 'walking')
        normalized_goal = (goal or '').strip().lower() or 'encourage'

        safety_flags: List[str] = []
        intent = normalized_goal
        reason = 'General encouragement'

        if normalized_goal == 'answer_question' and user_prompt:
            intent = 'answer_question'
            reason = 'Answering resident question'
            script = (
                f"I hear your question: {user_prompt.strip()}. "
                "Based on your current walk data, keep your posture tall and steps controlled."
            )
        elif fall_suspected:
            intent = 'safety_warning'
            reason = 'Fall risk signal present'
            safety_flags.append('fall_risk')
            script = 'Pause now and stabilize with the walker. Take one small step only when you feel balanced.'
        elif tilt_deg >= 20:
            intent = 'correct_posture'
            reason = 'High tilt detected'
            safety_flags.append('posture_risk')
            script = 'Stand tall and center your weight over the walker. Use small, controlled steps.'
        elif cadence > 0 and cadence < 70:
            intent = 'encourage'
            reason = 'Cadence below target'
            script = 'Nice effort. Increase your pace just a little while keeping smooth, steady steps.'
        elif balance >= 0.35:
            intent = 'balance_cue'
            reason = 'Balance asymmetry detected'
            script = 'Shift your weight evenly and keep the walker close. Slow, even steps will help your balance.'
        elif normalized_goal == 'safety_warning':
            intent = 'safety_warning'
            reason = 'Manual safety goal selected'
            safety_flags.append('manual_safety')
            script = 'Move carefully and keep both hands stable on the walker. Pause if you feel unsteady.'
        elif normalized_goal == 'correct_posture':
            intent = 'correct_posture'
            reason = 'Manual posture goal selected'
            script = 'Lift your chest, relax your shoulders, and keep your steps short and controlled.'
        else:
            intent = 'encourage'
            reason = 'Stable metrics'
            script = (
                f"Great work with {steps} steps so far. Keep your rhythm steady and your posture tall."
                if session_phase != 'idle'
                else 'You are ready to begin. Keep the walker close and take calm, steady steps.'
            )

        if tone == 'energetic':
            script = script + ' You have this.'

        meta = {
            'residentId': resident_id,
            'steps': steps,
            'tiltDeg': tilt_deg,
            'cadence': cadence,
            'balance': balance,
            'fallSuspected': fall_suspected,
            'sessionPhase': session_phase,
            'goal': normalized_goal,
            'tone': tone,
        }
        return script, reason, safety_flags, {'intent': intent, 'meta': meta}

    async def _gemini_polish(
        self,
        *,
        draft_script: str,
        intent: str,
        tone: str,
        safety_flags: List[str],
        context_meta: Dict[str, Any],
        user_prompt: Optional[str],
    ) -> Optional[str]:
        api_key = (self.settings.gemini_api_key or '').strip()
        if not api_key:
            return None

        model = (self.settings.gemini_model or 'gemini-1.5-flash').strip()
        base_url = (self.settings.gemini_base_url or 'https://generativelanguage.googleapis.com/v1beta').rstrip('/')
        url = f'{base_url}/models/{model}:generateContent?key={api_key}'

        prompt = (
            "You are a compassionate physical therapist coach. Rewrite the draft into natural spoken English.\n"
            "Constraints:\n"
            "- Max 2 sentences\n"
            "- Max 220 characters\n"
            "- Include an action cue (e.g., stand tall, small steps, steady pace)\n"
            "- If safety flags exist, include exactly one safety instruction\n"
            "- Avoid diagnosis/medical claims\n"
            "- No jargon, no bullet points\n\n"
            f"Intent: {intent}\n"
            f"Tone: {tone}\n"
            f"Safety Flags: {', '.join(safety_flags) if safety_flags else 'none'}\n"
            f"Context: {context_meta}\n"
            f"User Prompt: {user_prompt or 'none'}\n"
            f"Draft: {draft_script}\n"
            "Return only the final script text."
        )

        payload = {
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'generationConfig': {
                'temperature': 0.5,
                'maxOutputTokens': 160,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                raw = response.json()
            candidates = raw.get('candidates', []) if isinstance(raw, dict) else []
            parts = candidates[0].get('content', {}).get('parts', []) if candidates else []
            text = parts[0].get('text') if parts and isinstance(parts[0], dict) else None
            return text.strip() if isinstance(text, str) else None
        except Exception as exc:
            logger.warning('Gemini coach-script polish failed: %s', exc)
            return None

    async def generate_script(
        self,
        *,
        resident_id: str,
        context: Dict[str, Any],
        goal: str,
        tone: str,
        user_prompt: Optional[str],
    ) -> Dict[str, Any]:
        draft, reason, safety_flags, extra = self._rules_first(
            resident_id=resident_id,
            context=context,
            goal=goal,
            tone=tone,
            user_prompt=user_prompt,
        )

        intent = str(extra.get('intent') or goal or 'encourage')
        meta = extra.get('meta') if isinstance(extra.get('meta'), dict) else {}
        polished = await self._gemini_polish(
            draft_script=draft,
            intent=intent,
            tone=tone,
            safety_flags=safety_flags,
            context_meta=meta,
            user_prompt=user_prompt,
        )
        final_script = polished or draft
        final_script = _remove_diagnostic_language(_trim_script(final_script))
        final_script = _apply_cooldown(
            key=f'{resident_id}:{intent}',
            script=final_script,
            cooldown_seconds=max(1, int(self.settings.coach_script_cooldown_seconds)),
        )

        return {
            'script': final_script,
            'intent': intent,
            'safetyFlags': safety_flags,
            'meta': {
                **meta,
                'source': 'gemini' if polished else 'rules',
                'cooldownSeconds': int(self.settings.coach_script_cooldown_seconds),
            },
            'reason': reason,
        }

