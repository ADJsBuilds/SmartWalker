import base64
import json
import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LiveAvatarClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _base_url(self) -> str:
        base = (self.settings.liveavatar_base_url or self.settings.liveagent_base_url or '').strip()
        return (base or 'https://api.liveavatar.com').rstrip('/')

    def _api_key(self) -> str:
        return (self.settings.liveavatar_api_key or self.settings.liveagent_api_key or '').strip()

    def _provider_headers(self) -> Dict[str, str]:
        headers = {
            'Content-Type': 'application/json',
            'accept': 'application/json',
        }
        key = self._api_key()
        if key:
            headers['X-API-KEY'] = key
        return headers

    def _session_headers(self, session_token: str) -> Dict[str, str]:
        headers = self._provider_headers()
        headers['Authorization'] = f'Bearer {session_token}'
        return headers

    async def create_session_token(
        self,
        *,
        mode: str,
        avatar_id: str,
        interactivity_type: str,
        language: str,
        resident_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured'}

        payload: Dict[str, Any] = {
            'mode': mode,
            'avatar_id': avatar_id,
            'interactivity_type': interactivity_type,
            'avatar_persona': {'language': language},
        }
        if resident_id:
            payload['metadata'] = {'resident_id': resident_id}

        url = f'{self._base_url()}/v1/sessions/token'
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.post(url, json=payload, headers=self._provider_headers())
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error('LiveAvatar token HTTP error: status=%s', exc.response.status_code)
            return {'ok': False, 'error': f'HTTP {exc.response.status_code}: provider token creation failed'}
        except httpx.RequestError:
            logger.error('LiveAvatar token request failed')
            return {'ok': False, 'error': 'LiveAvatar token request failed'}

        code = raw.get('code') if isinstance(raw, dict) else None
        data = raw.get('data') if isinstance(raw, dict) else None
        session_id = data.get('session_id') if isinstance(data, dict) else None
        session_token = data.get('session_token') if isinstance(data, dict) else None
        if code != 1000 or not session_id or not session_token:
            logger.error('LiveAvatar token provider response invalid: code=%s', code)
            return {'ok': False, 'error': f'Provider token creation failed (code={code})', 'raw': raw}

        return {
            'ok': True,
            'sessionId': session_id,
            'sessionToken': session_token,
            'raw': raw,
        }

    async def start_session(self, *, session_id: str, session_token: str) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured'}

        url = f'{self._base_url()}/v1/sessions/start'
        payload = {'session_id': session_id}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.post(url, json=payload, headers=self._session_headers(session_token))
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error('LiveAvatar start HTTP error: status=%s', exc.response.status_code)
            return {'ok': False, 'error': f'HTTP {exc.response.status_code}: provider session start failed'}
        except httpx.RequestError:
            logger.error('LiveAvatar start request failed')
            return {'ok': False, 'error': 'LiveAvatar session start request failed'}

        code = raw.get('code') if isinstance(raw, dict) else None
        data = raw.get('data') if isinstance(raw, dict) else None
        if code != 1000 or not isinstance(data, dict):
            logger.error('LiveAvatar start provider response invalid: code=%s', code)
            return {'ok': False, 'error': f'Provider session start failed (code={code})', 'raw': raw}

        return {
            'ok': True,
            'sessionId': data.get('session_id'),
            'livekitUrl': data.get('livekit_url'),
            'livekitClientToken': data.get('livekit_client_token'),
            'maxSessionDuration': data.get('max_session_duration'),
            'wsUrl': data.get('ws_url'),
            'raw': raw,
        }


def extract_session_id_from_jwt(token: str) -> Optional[str]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload_part = parts[1]
        padding = '=' * (-len(payload_part) % 4)
        decoded = base64.urlsafe_b64decode(payload_part + padding).decode('utf-8')
        payload = json.loads(decoded)
        return payload.get('session_id')
    except Exception:
        return None

