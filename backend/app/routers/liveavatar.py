from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.lite_agent import lite_agent_manager
from app.audio.pcm import generate_test_tone_pcm16le
from app.core.config import get_settings
from app.services.liveavatar_lite import LiveAvatarLiteClient

router = APIRouter(tags=['liveavatar-lite'])


class LiteCreatePayload(BaseModel):
    avatar_id: Optional[str] = None
    voice_id: Optional[str] = None
    context_id: Optional[str] = None
    language: str = 'en'
    video_encoding: Literal['VP8', 'H264'] = 'VP8'
    video_quality: Literal['low', 'medium', 'high', 'very_high'] = 'high'
    is_sandbox: bool = False
    livekit_config: Optional[Dict[str, Any]] = None


class LiteCreateResponse(BaseModel):
    ok: bool
    session_id: Optional[str] = None
    session_token: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiteStartPayload(BaseModel):
    session_token: str


class LiteStartResponse(BaseModel):
    ok: bool
    session_id: Optional[str] = None
    session_token: Optional[str] = None
    livekit_url: Optional[str] = None
    livekit_client_token: Optional[str] = None
    livekit_agent_token: Optional[str] = None
    ws_url: Optional[str] = None
    max_session_duration: Optional[int] = None
    agent_ws_registered: bool = False
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiteStopPayload(BaseModel):
    session_id: str
    session_token: str


class LiteStopResponse(BaseModel):
    ok: bool
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


class LiteSessionControlPayload(BaseModel):
    session_id: str


class LiteSpeakTonePayload(BaseModel):
    session_id: str
    duration_seconds: float = 1.0
    frequency_hz: float = 440.0


@router.post('/api/liveavatar/lite/create', response_model=LiteCreateResponse)
@router.post('/heygen/session/token', response_model=LiteCreateResponse)
async def create_lite_token(payload: LiteCreatePayload):
    settings = get_settings()
    avatar_id = (payload.avatar_id or settings.liveavatar_avatar_id or settings.liveagent_avatar_id or '').strip()
    if not avatar_id:
        return {'ok': False, 'error': 'avatar_id is required'}

    result = await LiveAvatarLiteClient().create_session_token(
        avatar_id=avatar_id,
        voice_id=payload.voice_id,
        context_id=payload.context_id,
        language=payload.language,
        video_encoding=payload.video_encoding,
        video_quality=payload.video_quality,
        is_sandbox=payload.is_sandbox,
        livekit_config=payload.livekit_config,
    )
    if result.get('ok'):
        return {
            'ok': True,
            'session_id': result.get('session_id'),
            'session_token': result.get('session_token'),
            'error': None,
            'raw': result.get('raw'),
        }
    return {'ok': False, 'error': str(result.get('error') or 'token creation failed'), 'raw': result.get('raw')}


@router.post('/api/liveavatar/lite/start', response_model=LiteStartResponse)
@router.post('/heygen/session/start', response_model=LiteStartResponse)
async def start_lite_session(payload: LiteStartPayload):
    result = await LiveAvatarLiteClient().start_session(session_token=payload.session_token)
    if not result.get('ok'):
        return {'ok': False, 'error': str(result.get('error') or 'session start failed'), 'raw': result.get('raw')}

    session_id = str(result.get('session_id') or '')
    ws_url = str(result.get('ws_url') or '')
    agent_ws_registered = False
    if session_id and ws_url:
        state = await lite_agent_manager.register_session(session_id=session_id, ws_url=ws_url)
        agent_ws_registered = bool(state.ws_connected)

    return {
        'ok': True,
        'session_id': result.get('session_id'),
        'session_token': payload.session_token,
        'livekit_url': result.get('livekit_url'),
        'livekit_client_token': result.get('livekit_client_token'),
        'livekit_agent_token': result.get('livekit_agent_token'),
        'ws_url': result.get('ws_url'),
        'max_session_duration': result.get('max_session_duration'),
        'agent_ws_registered': agent_ws_registered,
        'error': None,
        'raw': result.get('raw'),
    }


@router.post('/api/liveavatar/lite/new', response_model=LiteStartResponse)
async def create_and_start_lite_session(payload: LiteCreatePayload):
    create_result = await create_lite_token(payload)
    if not create_result.get('ok'):
        return {'ok': False, 'error': create_result.get('error'), 'raw': create_result.get('raw')}

    start_result = await start_lite_session(LiteStartPayload(session_token=str(create_result.get('session_token') or '')))
    if not start_result.get('ok'):
        return {'ok': False, 'error': start_result.get('error'), 'raw': start_result.get('raw')}
    return start_result


@router.post('/api/liveavatar/lite/stop', response_model=LiteStopResponse)
@router.post('/heygen/session/stop', response_model=LiteStopResponse)
async def stop_lite_session(payload: LiteStopPayload):
    result = await LiveAvatarLiteClient().stop_session(session_id=payload.session_id, session_token=payload.session_token)
    await lite_agent_manager.close_session(payload.session_id)
    if result.get('ok'):
        return {'ok': True, 'error': None, 'raw': result.get('raw')}
    return {'ok': False, 'error': str(result.get('error') or 'session stop failed'), 'raw': result.get('raw')}


@router.get('/api/liveavatar/lite/status/{session_id}')
async def lite_session_status(session_id: str):
    return lite_agent_manager.get_status(session_id)


@router.post('/api/liveavatar/lite/interrupt')
async def interrupt_lite(payload: LiteSessionControlPayload):
    return await lite_agent_manager.send_interrupt(payload.session_id)


@router.post('/api/liveavatar/lite/start-listening')
async def start_listening_lite(payload: LiteSessionControlPayload):
    return await lite_agent_manager.start_listening(payload.session_id)


@router.post('/api/liveavatar/lite/stop-listening')
async def stop_listening_lite(payload: LiteSessionControlPayload):
    return await lite_agent_manager.stop_listening(payload.session_id)


@router.post('/api/liveavatar/lite/keepalive')
async def keepalive_lite(payload: LiteSessionControlPayload):
    return await lite_agent_manager.keep_alive(payload.session_id)


@router.post('/api/liveavatar/lite/test-tone')
async def speak_test_tone(payload: LiteSpeakTonePayload):
    pcm = generate_test_tone_pcm16le(duration_seconds=payload.duration_seconds, frequency_hz=payload.frequency_hz)
    return await lite_agent_manager.speak_pcm(payload.session_id, pcm)

