import logging
from typing import Any, Dict, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LiveAgentClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _base_url(self) -> str:
        base = (self.settings.liveagent_base_url or self.settings.heygen_base_url or 'https://api.heygen.com').rstrip('/')
        return base

    def _api_key(self) -> str:
        return (self.settings.liveagent_api_key or self.settings.heygen_api_key or '').strip()

    def _headers(self) -> Dict[str, str]:
        key = self._api_key()
        headers = {'Content-Type': 'application/json'}
        if key:
            # Keep both styles for provider compatibility across API revisions.
            headers['Authorization'] = f'Bearer {key}'
            headers['X-Api-Key'] = key
        return headers

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def create_session_token(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAGENT_API_KEY/HEYGEN_API_KEY not configured', 'raw': None}

        url = f'{self._base_url()}/v1/sessions/token'
        timeout = httpx.Timeout(20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=self._headers())
            response.raise_for_status()
            raw = response.json()
            token = _extract_first_string(raw, {'session_access_token', 'sessionAccessToken', 'token', 'access_token'})
            session_id = _extract_first_string(raw, {'session_id', 'sessionId'})
            return {
                'ok': bool(token),
                'sessionAccessToken': token,
                'sessionId': session_id,
                'raw': raw,
            }

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def stop_session(self, session_id: str) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAGENT_API_KEY/HEYGEN_API_KEY not configured', 'raw': None}
        url = f'{self._base_url()}/v1/sessions/{session_id}/stop'
        timeout = httpx.Timeout(15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=self._headers())
            response.raise_for_status()
            return {'ok': True, 'raw': response.json() if response.text else {}}


def _extract_first_string(value: Any, keys: set[str]) -> Optional[str]:
    if isinstance(value, dict):
        for key, candidate in value.items():
            if key in keys and isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for nested in value.values():
            hit = _extract_first_string(nested, keys)
            if hit:
                return hit
    elif isinstance(value, list):
        for item in value:
            hit = _extract_first_string(item, keys)
            if hit:
                return hit
    return None
