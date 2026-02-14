import logging
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.agents.lite_agent import lite_agent_manager
from app.audio.pcm import generate_test_tone_pcm16le
from app.core.config import get_settings
from app.services.elevenlabs_tts import ElevenLabsTTSService
from app.services.liveavatar_lite import LiveAvatarLiteClient

router = APIRouter(tags=['liveavatar-lite'])
logger = logging.getLogger(__name__)


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


class LiteSpeakTextPayload(BaseModel):
    session_id: str
    text: str
    voice_id: Optional[str] = None
    model_id: Optional[str] = None
    interrupt_before_speak: bool = True


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


@router.post('/api/liveavatar/lite/new')
async def create_and_start_lite_session(payload: Dict[str, Any]):
    result = await LiveAvatarLiteClient().create_heygen_lite_session(payload)

    if result.get('status_code') == 500 and result.get('error') == 'HEYGEN_API_KEY missing':
        return JSONResponse(status_code=500, content={'error': 'HEYGEN_API_KEY missing'})

    if result.get('status_code') == 502 and result.get('error') == 'HeyGen request failed':
        return JSONResponse(
            status_code=502,
            content={'error': 'HeyGen request failed', 'detail': str(result.get('detail') or 'request failed')},
        )

    status_code = int(result.get('status_code') or 502)
    json_parsed = bool(result.get('json_parsed'))
    body_json = result.get('body_json')
    body_text = str(result.get('body_text') or '')

    if status_code >= 400:
        return JSONResponse(
            status_code=status_code,
            content={
                'error': 'HeyGen lite/new failed',
                'status_code': status_code,
                'body': body_json if json_parsed else body_text,
            },
        )

    if not json_parsed or body_json is None:
        logger.error('HeyGen lite/new returned success status with empty/non-JSON body')
        return JSONResponse(
            status_code=502,
            content={'error': 'HeyGen returned empty body on success', 'status_code': status_code},
        )

    return JSONResponse(status_code=200, content=body_json)


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


@router.post('/api/liveavatar/lite/speak-text')
async def speak_text_lite(payload: LiteSpeakTextPayload):
    tts_result = await ElevenLabsTTSService().synthesize_pcm24(
        text=payload.text,
        voice_id=payload.voice_id,
        model_id=payload.model_id,
    )
    if not tts_result.get('ok'):
        return {'ok': False, 'error': str(tts_result.get('error') or 'TTS synthesis failed')}
    if payload.interrupt_before_speak:
        await lite_agent_manager.send_interrupt(payload.session_id)
    return await lite_agent_manager.speak_pcm(payload.session_id, tts_result.get('pcm') or b'')

