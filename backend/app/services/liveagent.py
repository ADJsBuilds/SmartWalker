import base64
import json
import logging
from typing import Any, Dict, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LiveAgentClient:
    """
    Backward-compatible service used by integrations.py.

    Implements the LiveAvatar sequence:
      1) POST /v1/sessions/token with X-API-KEY
      2) POST /v1/sessions/start with X-API-KEY + Authorization: Bearer <session_token>
    """

    def __init__(self) -> None:
        self.settings = get_settings()

    def _base_url(self) -> str:
        base = (self.settings.liveavatar_base_url or self.settings.liveagent_base_url or '').strip()
        return (base or 'https://api.liveavatar.com').rstrip('/')

    def _api_key(self) -> str:
        return (self.settings.liveavatar_api_key or self.settings.liveagent_api_key or self.settings.heygen_api_key or '').strip()

    def _provider_headers(self) -> Dict[str, str]:
        headers = {
            'Content-Type': 'application/json',
            'accept': 'application/json',
        }
        api_key = self._api_key()
        if api_key:
            headers['X-API-KEY'] = api_key
        return headers

    def _session_headers(self, session_token: str) -> Dict[str, str]:
        headers = self._provider_headers()
        headers['Authorization'] = f'Bearer {session_token}'
        return headers

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def create_session_token(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured', 'raw': None}

        url = f'{self._base_url()}/v1/sessions/token'
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.post(url, json=payload, headers=self._provider_headers())
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error('LiveAvatar token HTTP error: status=%s', exc.response.status_code)
            return {'ok': False, 'error': f'HTTP {exc.response.status_code}: provider token creation failed', 'raw': None}
        except httpx.RequestError:
            logger.error('LiveAvatar token request failed')
            return {'ok': False, 'error': 'LiveAvatar token request failed', 'raw': None}

        code = raw.get('code') if isinstance(raw, dict) else None
        data = raw.get('data') if isinstance(raw, dict) else None
        session_id = data.get('session_id') if isinstance(data, dict) else None
        session_token = data.get('session_token') if isinstance(data, dict) else None
        if code != 1000 or not session_id or not session_token:
            logger.error('LiveAvatar token provider response invalid: code=%s', code)
            return {'ok': False, 'error': f'Provider token creation failed (code={code})', 'raw': raw}

        return {
            'ok': True,
            'sessionAccessToken': session_token,
            'sessionId': session_id,
            'raw': raw,
        }

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def start_session(self, session_token: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured', 'raw': None}

        session_id = session_id or _extract_session_id_from_jwt(session_token)
        if not session_id:
            return {'ok': False, 'error': 'Unable to derive session_id from session token', 'raw': None}

        url = f'{self._base_url()}/v1/sessions/start'
        payload = {'session_id': session_id}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.post(url, json=payload, headers=self._session_headers(session_token))
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error('LiveAvatar start HTTP error: status=%s', exc.response.status_code)
            return {'ok': False, 'error': f'HTTP {exc.response.status_code}: provider session start failed', 'raw': None}
        except httpx.RequestError:
            logger.error('LiveAvatar start request failed')
            return {'ok': False, 'error': 'LiveAvatar session start request failed', 'raw': None}

        code = raw.get('code') if isinstance(raw, dict) else None
        data = raw.get('data') if isinstance(raw, dict) else None
        if code != 1000 or not isinstance(data, dict):
            logger.error('LiveAvatar start provider response invalid: code=%s', code)
            return {'ok': False, 'error': f'Provider session start failed (code={code})', 'raw': raw}

        return {
            'ok': True,
            'session_id': data.get('session_id'),
            'livekit_url': data.get('livekit_url'),
            'livekit_client_token': data.get('livekit_client_token'),
            'livekit_agent_token': data.get('livekit_agent_token'),
            'max_session_duration': data.get('max_session_duration'),
            'ws_url': data.get('ws_url'),
            'raw': raw,
        }

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def stop_session(self, session_id: str) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured', 'raw': None}

        urls = [
            f'{self._base_url()}/v1/sessions/{session_id}/stop',
            f'{self._base_url()}/v1/sessions/stop',
        ]
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            last_error: Optional[str] = None
            for url in urls:
                try:
                    body = {} if url.endswith(f'/{session_id}/stop') else {'session_id': session_id}
                    response = await client.post(url, json=body, headers=self._provider_headers())
                    response.raise_for_status()
                    return {'ok': True, 'raw': response.json() if response.text else {}}
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 404:
                        last_error = f'404 at {url}'
                        continue
                    logger.error('LiveAvatar stop HTTP error: status=%s', exc.response.status_code)
                    return {'ok': False, 'error': f'HTTP {exc.response.status_code}: provider session stop failed', 'raw': None}
                except httpx.RequestError as exc:
                    last_error = str(exc)
                    continue
            return {
                'ok': False,
                'error': f'Unable to stop session. Tried endpoints: {", ".join(urls)}. Last error: {last_error or "unknown"}',
                'raw': None,
            }

    @retry(stop=stop_after_attempt(2), wait=wait_fixed(1), reraise=True)
    async def send_full_mode_event(self, session_token: str, session_id: str, text: str) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured', 'raw': None}
        if not session_token:
            return {'ok': False, 'error': 'session token is required', 'raw': None}
        if not session_id:
            return {'ok': False, 'error': 'session id is required', 'raw': None}
        if not text.strip():
            return {'ok': False, 'error': 'text is required', 'raw': None}

        endpoints = [
            (
                f'{self._base_url()}/v1/sessions/{session_id}/events',
                {'event': {'type': 'agent.say', 'text': text.strip()}},
            ),
            (
                f'{self._base_url()}/v1/sessions/events',
                {'session_id': session_id, 'event': {'type': 'agent.say', 'text': text.strip()}},
            ),
            (
                f'{self._base_url()}/v1/sessions/{session_id}/messages',
                {'text': text.strip()},
            ),
        ]

        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            last_error: Optional[str] = None
            for url, payload in endpoints:
                try:
                    response = await client.post(url, json=payload, headers=self._session_headers(session_token))
                    response.raise_for_status()
                    raw = response.json() if response.text else {}
                    if isinstance(raw, dict):
                        code = raw.get('code')
                        if code in (100, 1000, None):
                            return {'ok': True, 'raw': raw}
                    return {'ok': True, 'raw': raw}
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code
                    body = exc.response.text[:300] if exc.response.text else ''
                    logger.warning('LiveAvatar full-mode event endpoint failed: status=%s path=%s body=%s', status, url, body)
                    if status in (404, 405, 422):
                        last_error = f'HTTP {status} at {url}'
                        continue
                    return {'ok': False, 'error': f'HTTP {status}: provider event call failed', 'raw': None}
                except httpx.RequestError as exc:
                    last_error = str(exc)
                    continue
            return {
                'ok': False,
                'error': f'Unable to send event with known endpoint formats. Last error: {last_error or "unknown"}',
                'raw': None,
            }


def _extract_session_id_from_jwt(token: str) -> Optional[str]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload_part = parts[1]
        padding = '=' * (-len(payload_part) % 4)
        decoded = base64.urlsafe_b64decode(payload_part + padding).decode('utf-8')
        payload = json.loads(decoded)
        session_id = payload.get('session_id')
        return session_id if isinstance(session_id, str) and session_id else None
    except Exception:
        return None

