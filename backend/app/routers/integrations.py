import logging
import uuid
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app.core.config import get_settings
from app.services.heygen import HeyGenClient
from app.services.liveagent import LiveAgentClient
from app.services.openevidence import OpenEvidenceClient, normalize_openevidence

router = APIRouter(tags=['integrations'])
logger = logging.getLogger(__name__)


class OpenEvidencePayload(BaseModel):
    query: str
    metadata: Optional[Dict[str, Any]] = None


class HeyGenPayload(BaseModel):
    payload: Dict[str, Any]


class HeyGenSpeakPayload(BaseModel):
    text: str
    residentId: Optional[str] = None
    voiceId: Optional[str] = None


class HeyGenSpeakResponse(BaseModel):
    ok: bool
    mode: str
    text: str
    residentId: Optional[str] = None
    videoUrl: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiveAgentSessionTokenPayload(BaseModel):
    residentId: Optional[str] = None
    avatarId: Optional[str] = None
    mode: Literal['FULL'] = 'FULL'
    interactivityType: Literal['PUSH_TO_TALK'] = 'PUSH_TO_TALK'
    language: str = 'en'

    @field_validator('avatarId')
    @classmethod
    def validate_avatar_uuid(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return value
        try:
            uuid.UUID(value)
            return value
        except ValueError as exc:
            raise ValueError('avatarId must be a valid UUID') from exc


class LiveAgentSessionTokenResponse(BaseModel):
    ok: bool
    mode: str
    residentId: Optional[str] = None
    sessionAccessToken: Optional[str] = None
    sessionId: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiveAgentStartPayload(BaseModel):
    sessionToken: str
    sessionId: Optional[str] = None


class LiveAgentStartResponse(BaseModel):
    ok: bool
    sessionId: Optional[str] = None
    livekitUrl: Optional[str] = None
    livekitClientToken: Optional[str] = None
    livekitAgentToken: Optional[str] = None
    maxSessionDuration: Optional[int] = None
    wsUrl: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiveAgentBootstrapResponse(BaseModel):
    ok: bool
    residentId: Optional[str] = None
    sessionId: Optional[str] = None
    sessionAccessToken: Optional[str] = None
    livekitUrl: Optional[str] = None
    livekitClientToken: Optional[str] = None
    livekitAgentToken: Optional[str] = None
    maxSessionDuration: Optional[int] = None
    wsUrl: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiveAgentStopPayload(BaseModel):
    sessionId: str


class LiveAgentSessionEventPayload(BaseModel):
    sessionToken: str
    sessionId: str
    text: str


class LiveAgentSessionEventResponse(BaseModel):
    ok: bool
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


def _provider_raw(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return value if get_settings().include_provider_raw else None


@router.post('/api/integrations/openevidence')
async def openevidence_proxy(payload: OpenEvidencePayload):
    client = OpenEvidenceClient()
    try:
        raw = await client.ask(payload.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'openevidence request failed: {exc}')
    return {'raw': raw, 'normalized': normalize_openevidence(raw if isinstance(raw, dict) else {})}


@router.post('/api/integrations/heygen')
async def heygen_proxy(payload: HeyGenPayload):
    """
    Deprecated passthrough endpoint kept for backward compatibility.
    """
    client = HeyGenClient()
    try:
        raw = await client.call(payload.payload)
        return {'raw': raw, 'deprecated': True}
    except Exception as exc:
        logger.error(f'HeyGen proxy call failed: {exc}', exc_info=True)
        raise HTTPException(status_code=502, detail=f'heygen request failed: {exc}')


@router.get('/api/heygen/avatars')
async def list_heygen_avatars_deprecated():
    raise HTTPException(status_code=410, detail='Deprecated. Use LiveAvatar avatar IDs.')


@router.post('/api/heygen/speak')
async def heygen_speak(payload: HeyGenSpeakPayload):
    """
    Deprecated endpoint kept temporarily to avoid breaking legacy coach actions.
    """
    client = HeyGenClient()
    result = await client.generate_video(payload.text, payload.voiceId)
    if result.get('success'):
        return {
            'ok': True,
            'mode': 'heygen',
            'text': payload.text,
            'residentId': payload.residentId,
            'videoUrl': result.get('video_url'),
            'error': None,
            'raw': _provider_raw(result.get('raw')),
            'deprecated': True,
        }
    return {
        'ok': False,
        'mode': 'fallback',
        'text': payload.text,
        'residentId': payload.residentId,
        'videoUrl': None,
        'error': result.get('error', 'Unknown error'),
        'raw': _provider_raw(result.get('raw')),
        'deprecated': True,
    }


@router.post('/api/liveagent/session/token', response_model=LiveAgentSessionTokenResponse)
async def create_liveagent_session_token(payload: LiveAgentSessionTokenPayload):
    settings = get_settings()
    client = LiveAgentClient()
    avatar_id = payload.avatarId or settings.liveavatar_avatar_id or settings.liveagent_avatar_id
    language = payload.language or settings.liveavatar_language or settings.liveagent_language or 'en'
    interactivity = payload.interactivityType or settings.liveavatar_interactivity_type or settings.liveagent_interactivity_type or 'PUSH_TO_TALK'

    if not avatar_id:
        return {
            'ok': False,
            'mode': 'fallback',
            'residentId': payload.residentId,
            'error': 'LIVEAVATAR_AVATAR_ID not configured',
            'raw': None,
        }

    try:
        uuid.UUID(avatar_id)
    except ValueError:
        return {
            'ok': False,
            'mode': 'fallback',
            'residentId': payload.residentId,
            'error': 'avatarId must be a valid UUID',
            'raw': None,
        }

    provider_payload: Dict[str, Any] = {
        'mode': payload.mode or 'FULL',
        'avatar_id': avatar_id,
        'interactivity_type': interactivity,
        'avatar_persona': {'language': language},
    }

    result = await client.create_session_token(provider_payload)
    if result.get('ok'):
        return {
            'ok': True,
            'mode': 'liveagent',
            'residentId': payload.residentId,
            'sessionAccessToken': result.get('sessionAccessToken'),
            'sessionId': result.get('sessionId'),
            'error': None,
            'raw': _provider_raw(result.get('raw')),
        }
    return {
        'ok': False,
        'mode': 'fallback',
        'residentId': payload.residentId,
        'error': str(result.get('error') or 'Failed to create LiveAgent session token'),
        'raw': _provider_raw(result.get('raw')),
    }


@router.post('/api/liveagent/session/start', response_model=LiveAgentStartResponse)
async def start_liveagent_session(payload: LiveAgentStartPayload):
    client = LiveAgentClient()
    result = await client.start_session(payload.sessionToken, payload.sessionId)
    if result.get('ok'):
        return {
            'ok': True,
            'sessionId': result.get('session_id'),
            'livekitUrl': result.get('livekit_url'),
            'livekitClientToken': result.get('livekit_client_token'),
            'livekitAgentToken': result.get('livekit_agent_token'),
            'maxSessionDuration': result.get('max_session_duration'),
            'wsUrl': result.get('ws_url'),
            'error': None,
            'raw': _provider_raw(result.get('raw')),
        }
    return {
        'ok': False,
        'error': str(result.get('error') or 'Failed to start LiveAgent session'),
        'raw': _provider_raw(result.get('raw')),
    }


@router.post('/api/liveagent/session/bootstrap', response_model=LiveAgentBootstrapResponse)
async def bootstrap_liveagent_session(payload: LiveAgentSessionTokenPayload):
    token_result = await create_liveagent_session_token(payload)
    if not token_result.get('ok'):
        return {
            'ok': False,
            'residentId': payload.residentId,
            'error': token_result.get('error'),
            'raw': token_result.get('raw'),
        }

    start_result = await start_liveagent_session(
        LiveAgentStartPayload(
            sessionToken=str(token_result.get('sessionAccessToken') or ''),
            sessionId=token_result.get('sessionId'),
        )
    )
    if not start_result.get('ok'):
        return {
            'ok': False,
            'residentId': payload.residentId,
            'sessionId': token_result.get('sessionId'),
            'sessionAccessToken': token_result.get('sessionAccessToken'),
            'error': start_result.get('error'),
            'raw': start_result.get('raw'),
        }

    return {
        'ok': True,
        'residentId': payload.residentId,
        'sessionId': start_result.get('sessionId'),
        'sessionAccessToken': token_result.get('sessionAccessToken'),
        'livekitUrl': start_result.get('livekitUrl'),
        'livekitClientToken': start_result.get('livekitClientToken'),
        'livekitAgentToken': start_result.get('livekitAgentToken'),
        'maxSessionDuration': start_result.get('maxSessionDuration'),
        'wsUrl': start_result.get('wsUrl'),
        'error': None,
        'raw': start_result.get('raw'),
    }


@router.post('/api/liveagent/session/stop')
async def stop_liveagent_session(payload: LiveAgentStopPayload):
    client = LiveAgentClient()
    try:
        return await client.stop_session(payload.sessionId)
    except Exception as exc:
        logger.error(f'LiveAgent session stop failed: {exc}', exc_info=True)
        raise HTTPException(status_code=502, detail=f'liveagent stop failed: {exc}')


@router.post('/api/liveagent/session/event', response_model=LiveAgentSessionEventResponse)
async def send_liveagent_session_event(payload: LiveAgentSessionEventPayload):
    client = LiveAgentClient()
    result = await client.send_full_mode_event(
        session_token=payload.sessionToken,
        session_id=payload.sessionId,
        text=payload.text,
    )
    if result.get('ok'):
        return {'ok': True, 'error': None, 'raw': _provider_raw(result.get('raw'))}
    return {'ok': False, 'error': str(result.get('error') or 'Failed to send session event'), 'raw': _provider_raw(result.get('raw'))}
