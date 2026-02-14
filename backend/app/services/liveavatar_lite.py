import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LiveAvatarLiteClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _base_url(self) -> str:
        base = (self.settings.liveavatar_base_url or self.settings.liveagent_base_url or '').strip()
        return (base or 'https://api.liveavatar.com').rstrip('/')

    def _api_key(self) -> str:
        return (self.settings.liveavatar_api_key or self.settings.liveagent_api_key or '').strip()

    def _provider_headers(self) -> Dict[str, str]:
        key = self._api_key()
        headers = {'Content-Type': 'application/json', 'accept': 'application/json'}
        if key:
            headers['X-API-KEY'] = key
        return headers

    @staticmethod
    def _session_headers(session_token: str) -> Dict[str, str]:
        return {
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'authorization': f'Bearer {session_token}',
        }

    async def create_session_token(
        self,
        *,
        avatar_id: str,
        voice_id: Optional[str] = None,
        context_id: Optional[str] = None,
        language: str = 'en',
        video_encoding: str = 'VP8',
        video_quality: str = 'high',
        is_sandbox: bool = False,
        livekit_config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAVATAR_API_KEY not configured'}

        payload: Dict[str, Any] = {
            'mode': 'LITE',
            'avatar_id': avatar_id,
            'avatar_persona': {'language': language or 'en'},
            'is_sandbox': bool(is_sandbox),
            'video_settings': {'encoding': video_encoding, 'quality': video_quality},
        }
        if voice_id:
            payload['avatar_persona']['voice_id'] = voice_id
        if context_id:
            payload['avatar_persona']['context_id'] = context_id
        if livekit_config:
            payload['livekit_config'] = livekit_config

        url = f'{self._base_url()}/v1/sessions/token'
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.post(url, json=payload, headers=self._provider_headers())
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error('LiveAvatar LITE token HTTP error: %s', exc.response.status_code)
            return {'ok': False, 'error': f'HTTP {exc.response.status_code}: token creation failed'}
        except httpx.RequestError as exc:
            logger.error('LiveAvatar LITE token request failed: %s', exc)
            return {'ok': False, 'error': 'token request failed'}

        code = raw.get('code') if isinstance(raw, dict) else None
        data = raw.get('data') if isinstance(raw, dict) else None
        session_id = data.get('session_id') if isinstance(data, dict) else None
        session_token = data.get('session_token') if isinstance(data, dict) else None
        if code != 1000 or not session_id or not session_token:
            return {'ok': False, 'error': f'Provider token creation failed (code={code})', 'raw': raw}

        return {'ok': True, 'session_id': session_id, 'session_token': session_token, 'raw': raw}

    async def start_session(self, *, session_token: str) -> Dict[str, Any]:
        url = f'{self._base_url()}/v1/sessions/start'
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
                response = await client.post(url, json={}, headers=self._session_headers(session_token))
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            logger.error('LiveAvatar LITE start HTTP error: %s', exc.response.status_code)
            return {'ok': False, 'error': f'HTTP {exc.response.status_code}: session start failed'}
        except httpx.RequestError as exc:
            logger.error('LiveAvatar LITE start request failed: %s', exc)
            return {'ok': False, 'error': 'session start request failed'}

        code = raw.get('code') if isinstance(raw, dict) else None
        data = raw.get('data') if isinstance(raw, dict) else None
        if code != 1000 or not isinstance(data, dict):
            return {'ok': False, 'error': f'Provider session start failed (code={code})', 'raw': raw}

        return {
            'ok': True,
            'session_id': data.get('session_id'),
            'livekit_url': data.get('livekit_url'),
            'livekit_client_token': data.get('livekit_client_token'),
            'livekit_agent_token': data.get('livekit_agent_token'),
            'ws_url': data.get('ws_url'),
            'max_session_duration': data.get('max_session_duration'),
            'raw': raw,
        }

    async def stop_session(self, *, session_id: str, session_token: str) -> Dict[str, Any]:
        urls = [
            f'{self._base_url()}/v1/sessions/stop',
            f'{self._base_url()}/v1/sessions/{session_id}/stop',
        ]
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            last_error = 'unknown'
            for url in urls:
                payload = {'session_id': session_id} if url.endswith('/sessions/stop') else {}
                try:
                    response = await client.post(url, json=payload, headers=self._session_headers(session_token))
                    response.raise_for_status()
                    return {'ok': True, 'raw': response.json() if response.text else {}}
                except httpx.HTTPStatusError as exc:
                    last_error = f'HTTP {exc.response.status_code} at {url}'
                    if exc.response.status_code in (404, 405):
                        continue
                    return {'ok': False, 'error': last_error}
                except httpx.RequestError as exc:
                    last_error = str(exc)
                    continue
        return {'ok': False, 'error': f'Unable to stop session. Last error: {last_error}'}

