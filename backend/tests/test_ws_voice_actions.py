from collections.abc import AsyncIterator
from typing import Any

from fastapi.testclient import TestClient

from app.main import app
import app.routers.ws as ws_router


def _drain_ready(ws) -> None:
    for _ in range(10):
        msg = ws.receive_json()
        if msg.get('type') == 'ready':
            return
    raise AssertionError('Did not receive ready frame')


def _collect_until(ws, target_types: set[str], max_frames: int = 40) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for _ in range(max_frames):
        frame = ws.receive_json()
        frames.append(frame)
        if target_types.issubset({str(f.get('type') or '') for f in frames}):
            return frames
    raise AssertionError(f'Did not receive target frame types: {target_types}')


async def _fake_stream_tts_pcm(_self, _text: str) -> AsyncIterator[bytes]:
    if False:
        yield b''


def test_ws_voice_agent_zoom_action_confirm_flow(monkeypatch):
    monkeypatch.setattr(ws_router.VoiceSqlPipeline, 'stream_tts_pcm', _fake_stream_tts_pcm)
    monkeypatch.setattr(ws_router, 'resolve_contact', lambda _settings, _label: 'daughter@example.com')
    monkeypatch.setattr(ws_router, 'create_zoom_meeting', lambda _settings, _label: 'https://zoom.us/j/abc123')
    monkeypatch.setattr(ws_router, 'send_meeting_email', lambda _settings, _email, _join, _label: None)

    with TestClient(app) as client:
        with client.websocket_connect('/ws/voice-agent') as ws:
            _drain_ready(ws)

            ws.send_json({'type': 'user_message', 'text': 'Zoom my daughter'})
            frames = _collect_until(ws, {'action_detected', 'action_confirm_required', 'agent_response'})
            frame_types = {str(f.get('type') or '') for f in frames}
            assert 'sql_generated' not in frame_types
            detect_frame = next(f for f in frames if f.get('type') == 'action_detected')
            assert detect_frame.get('action') == 'zoom_invite'
            assert detect_frame.get('contactLabel') == 'daughter'

            ws.send_json({'type': 'user_message', 'text': 'yes'})
            executed_frames = _collect_until(ws, {'action_executed', 'agent_response'})
            executed = next(f for f in executed_frames if f.get('type') == 'action_executed')
            assert executed.get('ok') is True
            assert executed.get('sentTo') == 'daughter@example.com'


def test_ws_voice_agent_sql_path_still_works(monkeypatch):
    async def _fake_generate_sql(_self, _question: str, _resident_id: str) -> str:
        return "SELECT 1 AS steps"

    def _fake_execute_sql(_self, _db, _sql: str, resident_id=None):
        return [{'steps': 1}]

    async def _fake_generate_answer(_self, **_kwargs) -> str:
        return 'You took 1 step in this sample.'

    monkeypatch.setattr(ws_router.VoiceSqlPipeline, 'generate_sql', _fake_generate_sql)
    monkeypatch.setattr(ws_router.VoiceSqlPipeline, 'execute_sql', _fake_execute_sql)
    monkeypatch.setattr(ws_router.VoiceSqlPipeline, 'generate_answer', _fake_generate_answer)
    monkeypatch.setattr(ws_router.VoiceSqlPipeline, 'stream_tts_pcm', _fake_stream_tts_pcm)

    with TestClient(app) as client:
        with client.websocket_connect('/ws/voice-agent') as ws:
            _drain_ready(ws)
            ws.send_json({'type': 'user_message', 'text': 'How many steps today?'})
            frames = _collect_until(ws, {'sql_generated', 'sql_result', 'agent_response'})
            frame_types = {str(f.get('type') or '') for f in frames}
            assert 'action_detected' not in frame_types

