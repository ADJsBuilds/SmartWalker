import logging
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class LiveAgentClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _base_url(self) -> str:
        if self.settings.liveagent_base_url:
            return self.settings.liveagent_base_url.rstrip('/')
        # Avoid inheriting old HEYGEN_BASE_URL (often a path endpoint like /v1/video/generate).
        # LiveAgent SDK uses api.liveavatar.com by default.
        if self.settings.heygen_base_url:
            parsed = urlparse(self.settings.heygen_base_url)
            if parsed.netloc == 'api.liveavatar.com':
                return f'{parsed.scheme or "https"}://{parsed.netloc}'
        return 'https://api.liveavatar.com'

    def _api_key(self) -> str:
        return (self.settings.liveagent_api_key or self.settings.heygen_api_key or '').strip()

    def _headers(self, use_session_token: Optional[str] = None) -> Dict[str, str]:
        """
        Get headers for LiveAvatar API requests.
        
        According to LiveAvatar API docs, use X-API-KEY header for token creation.
        For start session, use Authorization: Bearer with session_token.
        """
        headers = {
            'Content-Type': 'application/json',
            'accept': 'application/json',
        }
        
        if use_session_token:
            # For start session, use the session token as Bearer token
            headers['Authorization'] = f'Bearer {use_session_token}'
        else:
            # For token creation, use API key
            key = self._api_key()
            if key:
                headers['X-API-KEY'] = key
                # Also include Bearer for backward compatibility
                headers['Authorization'] = f'Bearer {key}'
        
        return headers

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def create_session_token(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAGENT_API_KEY/HEYGEN_API_KEY not configured', 'raw': None}

        base = self._base_url()
        candidate_urls = [
            f'{base}/v1/sessions/token',
            f'{base}/v1/session/token',
            f'{base}/v1/liveavatar/sessions/token',
        ]

        timeout = httpx.Timeout(20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            last_error: Optional[str] = None
            for url in candidate_urls:
                try:
                    response = await client.post(url, json=payload, headers=self._headers())
                    response.raise_for_status()
                    raw = response.json()
                    
                    logger.debug(f'LiveAvatar API response: {raw}')
                    
                    # LiveAvatar returns: { "code": 1000, "data": { "session_id": "...", "session_token": "..." }, ... }
                    # Accept both 100 and 1000 as success codes
                    code = raw.get('code') if isinstance(raw, dict) else None
                    session_token = None
                    session_id = None
                    
                    if isinstance(raw, dict) and isinstance(raw.get('data'), dict):
                        data = raw.get('data') or {}
                        session_token = data.get('session_token') or data.get('sessionToken')
                        session_id = data.get('session_id') or data.get('sessionId')
                    else:
                        # Fallback: try to extract from any location
                        session_token = _extract_first_string(
                            raw,
                            {
                                'session_access_token',
                                'sessionAccessToken',
                                'session_token',
                                'sessionToken',
                                'token',
                                'access_token',
                            },
                        )
                        session_id = _extract_first_string(raw, {'session_id', 'sessionId'})
                    
                    if session_token:
                        logger.info(f'Successfully created LiveAvatar session token (session_id: {session_id}, code: {code})')
                        return {
                            'ok': True,
                            'sessionAccessToken': session_token,
                            'sessionId': session_id,
                            'raw': raw,
                            'tokenEndpoint': url,
                            'baseUrl': base,
                        }
                    else:
                        logger.error(f'LiveAvatar response missing session_token. Response code: {code}, Response: {raw}')
                        return {
                            'ok': False,
                            'error': f'Response missing session_token. Response code: {code}, message: {raw.get("message", "Unknown error")}',
                            'raw': raw,
                        }
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 404:
                        last_error = f'404 at {url}'
                        continue
                    raise
                except httpx.RequestError as exc:
                    last_error = str(exc)
                    continue
            return {
                'ok': False,
                'error': f'Unable to create token. Base URL: {base}. Tried endpoints: {", ".join(candidate_urls)}. Last error: {last_error or "unknown"}',
                'raw': None,
            }

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def start_session(self, session_token: str) -> Dict[str, Any]:
        """
        Start a LiveAvatar session.
        
        According to LiveAvatar API docs:
        - Endpoint: POST https://api.liveavatar.com/v1/sessions/start
        - Header: Authorization: Bearer {session_token}
        - Response format:
          {
            "code": 100,
            "data": {
              "session_id": "string",
              "livekit_url": "string",
              "livekit_client_token": "string",
              "livekit_agent_token": "string",
              "max_session_duration": 0,
              "ws_url": "string"
            }
          }
        """
        base = self._base_url()
        url = f'{base}/v1/sessions/start'
        
        timeout = httpx.Timeout(20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                logger.info(f'Starting LiveAvatar session at {url}')
                
                # Use session token as Bearer token
                response = await client.post(
                    url,
                    json={'session_token': session_token},
                    headers=self._headers(use_session_token=session_token),
                )
                response.raise_for_status()
                raw = response.json()
                
                logger.debug(f'LiveAvatar start session response: {raw}')
                
                # Extract from response structure
                code = raw.get('code') if isinstance(raw, dict) else None
                session_data = {}
                
                if isinstance(raw, dict) and isinstance(raw.get('data'), dict):
                    data = raw['data']
                    session_data = {
                        'session_id': data.get('session_id'),
                        'livekit_url': data.get('livekit_url'),
                        'livekit_client_token': data.get('livekit_client_token'),
                        'livekit_agent_token': data.get('livekit_agent_token'),
                        'max_session_duration': data.get('max_session_duration'),
                        'ws_url': data.get('ws_url'),
                    }
                
                if code in (100, 1000) or session_data.get('session_id'):
                    logger.info(f'Successfully started LiveAvatar session (session_id: {session_data.get("session_id")})')
                    return {
                        'ok': True,
                        'code': code,
                        **session_data,
                        'raw': raw,
                    }
                else:
                    logger.error(f'LiveAvatar start session failed. Response code: {code}, Response: {raw}')
                    return {
                        'ok': False,
                        'error': f'Failed to start session. Response code: {code}, message: {raw.get("message", "Unknown error")}',
                        'raw': raw,
                    }
            except httpx.HTTPStatusError as exc:
                error_text = exc.response.text if exc.response else 'No response'
                logger.error(f'LiveAvatar start session HTTP error: {exc.response.status_code} - {error_text}')
                try:
                    error_json = exc.response.json() if exc.response else {}
                    error_msg = error_json.get('message') or error_json.get('detail') or error_text
                except:
                    error_msg = error_text
                return {
                    'ok': False,
                    'error': f'HTTP {exc.response.status_code}: {error_msg[:200]}',
                    'raw': None,
                }
            except httpx.RequestError as exc:
                logger.error(f'LiveAvatar start session request error: {exc}')
                return {
                    'ok': False,
                    'error': f'Request failed: {str(exc)}',
                    'raw': None,
                }
            except Exception as exc:
                logger.error(f'LiveAvatar start session unexpected error: {exc}', exc_info=True)
                return {
                    'ok': False,
                    'error': f'Unexpected error: {str(exc)}',
                    'raw': None,
                }

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def stop_session(self, session_id: str) -> Dict[str, Any]:
        if not self._api_key():
            return {'ok': False, 'error': 'LIVEAGENT_API_KEY/HEYGEN_API_KEY not configured', 'raw': None}
        base = self._base_url()
        candidate_urls = [
            f'{base}/v1/sessions/{session_id}/stop',
            f'{base}/v1/session/{session_id}/stop',
            f'{base}/v1/liveavatar/sessions/{session_id}/stop',
        ]
        timeout = httpx.Timeout(15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            last_error: Optional[str] = None
            for url in candidate_urls:
                try:
                    response = await client.post(url, headers=self._headers())
                    response.raise_for_status()
                    return {'ok': True, 'raw': response.json() if response.text else {}, 'stopEndpoint': url}
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 404:
                        last_error = f'404 at {url}'
                        continue
                    raise
                except httpx.RequestError as exc:
                    last_error = str(exc)
                    continue
            return {
                'ok': False,
                'error': f'Unable to stop session. Tried endpoints: {", ".join(candidate_urls)}. Last error: {last_error or "unknown"}',
                'raw': None,
            }


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
