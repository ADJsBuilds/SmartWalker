import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.core.config import get_settings

router = APIRouter(tags=['eleven'])

_RATE_LIMIT_CAPACITY = 30
_RATE_LIMIT_REFILL_PER_SECOND = _RATE_LIMIT_CAPACITY / 60.0


@dataclass
class _TokenBucket:
    tokens: float
    last_refill_ts: float


_rate_buckets: Dict[str, _TokenBucket] = {}
_rate_lock = threading.Lock()
_sessions: Dict[str, Dict[str, Any]] = {}


class ElevenSessionPayload(BaseModel):
    agent_id: Optional[str] = None
    user_id: Optional[str] = None


def _allow_request(client_key: str) -> bool:
    now = time.monotonic()
    with _rate_lock:
        bucket = _rate_buckets.get(client_key)
        if bucket is None:
            bucket = _TokenBucket(tokens=_RATE_LIMIT_CAPACITY, last_refill_ts=now)
            _rate_buckets[client_key] = bucket

        elapsed = max(0.0, now - bucket.last_refill_ts)
        bucket.tokens = min(_RATE_LIMIT_CAPACITY, bucket.tokens + elapsed * _RATE_LIMIT_REFILL_PER_SECOND)
        bucket.last_refill_ts = now
        if bucket.tokens < 1.0:
            return False
        bucket.tokens -= 1.0
        return True


def _client_key(request: Request) -> str:
    host = request.client.host if request.client else ''
    return host or 'unknown'


def _upstream_json_or_text(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return response.text


async def _fetch_signed_url(agent_id: str) -> str:
    settings = get_settings()
    api_key = (settings.elevenlabs_api_key or '').strip()
    if not api_key:
        raise HTTPException(status_code=500, detail='ELEVENLABS_API_KEY is not configured')

    base_url = (settings.elevenlabs_base_url or 'https://api.elevenlabs.io').rstrip('/')
    endpoint = f'{base_url}/v1/convai/conversation/get-signed-url'
    headers = {'xi-api-key': api_key}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)) as client:
            response = await client.get(endpoint, params={'agent_id': agent_id}, headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(status_code=502, detail='Timed out while requesting ElevenLabs signed URL')
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f'Failed to reach ElevenLabs: {exc}')

    if response.status_code != 200:
        body = _upstream_json_or_text(response)
        raise HTTPException(
            status_code=response.status_code,
            detail={'error': 'ElevenLabs signed URL request failed', 'upstream': body},
        )

    body = _upstream_json_or_text(response)
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail='ElevenLabs returned an unexpected signed URL response')
    signed_url = str(body.get('signed_url') or '').strip()
    if not signed_url:
        raise HTTPException(status_code=502, detail='ElevenLabs response did not include signed_url')
    return signed_url


@router.get('/api/eleven/signed-url')
async def eleven_signed_url(request: Request, agent_id: Optional[str] = Query(default=None)):
    if not _allow_request(_client_key(request)):
        raise HTTPException(status_code=429, detail='Rate limit exceeded for /api/eleven/signed-url')

    settings = get_settings()
    resolved_agent_id = (agent_id or settings.elevenlabs_agent_id or '').strip()
    if not resolved_agent_id:
        raise HTTPException(status_code=400, detail='agent_id query param required (or set ELEVENLABS_AGENT_ID)')

    signed_url = await _fetch_signed_url(resolved_agent_id)
    return {'signed_url': signed_url}


@router.get('/api/elevenlabs/signed-url')
async def elevenlabs_signed_url_alias(request: Request, agent_id: Optional[str] = Query(default=None)):
    return await eleven_signed_url(request=request, agent_id=agent_id)


@router.post('/api/eleven/session')
async def create_eleven_session(request: Request, payload: ElevenSessionPayload):
    if not _allow_request(_client_key(request)):
        raise HTTPException(status_code=429, detail='Rate limit exceeded for /api/eleven/session')

    settings = get_settings()
    resolved_agent_id = (payload.agent_id or settings.elevenlabs_agent_id or '').strip()
    if not resolved_agent_id:
        raise HTTPException(status_code=400, detail='agent_id is required (or set ELEVENLABS_AGENT_ID)')

    signed_url = await _fetch_signed_url(resolved_agent_id)

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        'session_id': session_id,
        'agent_id': resolved_agent_id,
        'user_id': (payload.user_id or '').strip() or None,
        'created_at': int(time.time()),
    }
    return {'session_id': session_id, 'signed_url': signed_url}

