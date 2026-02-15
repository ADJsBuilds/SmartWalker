import json
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx

from app.core.config import Settings, get_settings
from app.services.carrier import parse_phrase_to_label


def _normalize_text(value: str) -> str:
    return ' '.join(str(value or '').strip().lower().split())


def _normalize_label(value: str) -> str:
    cleaned = str(value or '').strip().strip(".,!?;:")
    cleaned = re.sub(r'^(my|a|an|the)\s+', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().lower()
    return cleaned


def parse_confirmation(value: str) -> str:
    text = _normalize_text(value)
    if not text:
        return 'unknown'
    positive = (
        'yes',
        'yeah',
        'yep',
        'confirm',
        'do it',
        'go ahead',
        'send it',
        'please send',
        'ok send',
        'okay send',
        'sure',
    )
    negative = (
        'no',
        'nope',
        'cancel',
        'stop',
        'dont',
        "don't",
        'do not',
        'never mind',
        'not now',
    )
    if any(text == token or text.startswith(f'{token} ') for token in positive):
        return 'confirm'
    if any(text == token or text.startswith(f'{token} ') for token in negative):
        return 'deny'
    return 'unknown'


@dataclass
class ZoomActionCandidate:
    action_type: str
    contact_label: str
    source: str
    confidence: float = 1.0


def _extract_output_text(payload: Dict[str, Any]) -> str:
    direct = payload.get('output_text')
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    output = payload.get('output')
    if not isinstance(output, list):
        return ''
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get('content')
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict):
                continue
            text_value = part.get('text') or part.get('output_text')
            if isinstance(text_value, str) and text_value.strip():
                return text_value.strip()
    return ''


class VoiceActionRouter:
    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()

    def detect_zoom_action_deterministic(self, transcript: str) -> Optional[ZoomActionCandidate]:
        text = _normalize_text(transcript)
        if not text:
            return None

        exact = parse_phrase_to_label(text)
        if exact:
            label = _normalize_label(exact)
            if label:
                return ZoomActionCandidate(action_type='zoom_invite', contact_label=label, source='deterministic')

        patterns = [
            r'^(?:please\s+)?(?:schedule|set up|setup|start|create|send)\s+(?:a\s+)?zoom(?:\s+call|\s+meeting)?\s+(?:with|for|to)\s+(.+)$',
            r'^(?:please\s+)?(?:call|zoom)\s+(.+?)\s+(?:on|via)\s+zoom$',
            r'^(?:can you|could you|please)\s+(?:zoom|call)\s+my\s+(.+)$',
        ]
        for pattern in patterns:
            match = re.match(pattern, text, flags=re.IGNORECASE)
            if not match:
                continue
            label = _normalize_label(match.group(1))
            if label:
                return ZoomActionCandidate(action_type='zoom_invite', contact_label=label, source='deterministic')
        return None

    async def detect_zoom_action(self, transcript: str) -> Optional[ZoomActionCandidate]:
        deterministic = self.detect_zoom_action_deterministic(transcript)
        if deterministic:
            return deterministic
        if not bool(self.settings.voice_action_enable_llm_fallback):
            return None
        return await self._detect_zoom_action_with_llm(transcript)

    async def _detect_zoom_action_with_llm(self, transcript: str) -> Optional[ZoomActionCandidate]:
        api_key = (self.settings.openai_api_key or '').strip()
        if not api_key:
            return None
        model = (self.settings.openai_answer_model or self.settings.openai_sql_model or 'gpt-4o-mini').strip()
        system = (
            "Classify whether the user is requesting that the assistant send a Zoom invite. "
            "Return JSON only with keys: action, contact_label, confidence. "
            "Use action='zoom_invite' only for explicit intent to start/schedule/send a Zoom meeting. "
            "Otherwise set action='none'."
        )
        user = (
            f"transcript: {transcript}\n"
            "Rules:\n"
            "- If contact is present, extract short label only (e.g., daughter, physical therapist).\n"
            "- confidence is 0..1.\n"
            "- If unsure, action='none'."
        )
        payload = {
            'model': model,
            'input': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user},
            ],
        }
        url = f"{(self.settings.openai_base_url or 'https://api.openai.com/v1').rstrip('/')}/responses"
        headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                raw = response.json()
        except Exception:
            return None

        output_text = _extract_output_text(raw if isinstance(raw, dict) else {})
        if not output_text:
            return None
        parsed: Optional[Dict[str, Any]] = None
        try:
            parsed = json.loads(output_text)
        except json.JSONDecodeError:
            first = output_text.find('{')
            last = output_text.rfind('}')
            if first != -1 and last != -1 and last > first:
                try:
                    parsed = json.loads(output_text[first : last + 1])
                except json.JSONDecodeError:
                    parsed = None
        if not isinstance(parsed, dict):
            return None

        action = _normalize_text(str(parsed.get('action') or 'none'))
        if action != 'zoom_invite':
            return None
        label = _normalize_label(str(parsed.get('contact_label') or ''))
        if not label:
            return None
        try:
            confidence = float(parsed.get('confidence') or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence < 0.6:
            return None
        return ZoomActionCandidate(
            action_type='zoom_invite',
            contact_label=label,
            source='llm_fallback',
            confidence=max(0.0, min(1.0, confidence)),
        )

    async def generate_proactive_message(
        self,
        *,
        event_type: str,
        metrics_snapshot: Optional[Dict[str, Any]] = None,
    ) -> str:
        normalized_event = _normalize_text(event_type)
        fallback = self._fallback_proactive_message(normalized_event, metrics_snapshot or {})
        api_key = (self.settings.openai_api_key or '').strip()
        if not api_key:
            return fallback

        model = (self.settings.openai_answer_model or self.settings.openai_sql_model or 'gpt-4o-mini').strip()
        is_fall = normalized_event == 'fall'
        system = (
            "You are a proactive mobility safety assistant speaking through an avatar in a senior-care setting. "
            "Return plain text only, 1-2 short sentences, easy to speak aloud, warm and direct. "
            "Do not diagnose. Give concrete next-step guidance."
        )
        user = (
            f"event_type: {normalized_event}\n"
            f"metrics_snapshot: {json.dumps(metrics_snapshot or {}, ensure_ascii=True)}\n"
            + (
                "Must express concern and ask if they want to call for help."
                if is_fall
                else "Give concise coaching advice for safety and posture."
            )
        )
        payload = {
            'model': model,
            'input': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': user},
            ],
        }
        url = f"{(self.settings.openai_base_url or 'https://api.openai.com/v1').rstrip('/')}/responses"
        headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                raw = response.json()
        except Exception:
            return fallback

        text_value = _extract_output_text(raw if isinstance(raw, dict) else {}).strip()
        if not text_value:
            return fallback
        if is_fall:
            lower = text_value.lower()
            if 'help' not in lower or '?' not in text_value:
                return fallback
        return text_value

    def _fallback_proactive_message(self, event_type: str, metrics_snapshot: Dict[str, Any]) -> str:
        if event_type == 'fall':
            return "I noticed a possible fall and I am concerned. Do you want me to call for help?"
        if event_type == 'high_load':
            reliance = metrics_snapshot.get('reliance')
            if isinstance(reliance, (int, float)):
                return (
                    f"I am noticing high weight on the walker, around {float(reliance):.1f} kilograms. "
                    "Please slow down and keep your posture centered."
                )
            return "I am noticing high weight on the walker. Please slow down and keep your posture centered."
        if event_type == 'imbalance':
            balance = metrics_snapshot.get('balance')
            if isinstance(balance, (int, float)):
                side = 'left' if float(balance) > 0 else 'right'
                return (
                    f"You are leaning more to your {side} side right now. "
                    "Try to redistribute your weight evenly on both handles."
                )
            return "You look unbalanced right now. Try to redistribute your weight evenly on both handles."
        return "I noticed a safety-related change. Please move slowly and keep balanced posture."

