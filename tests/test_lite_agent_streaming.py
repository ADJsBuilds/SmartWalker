import asyncio
import base64

from app.agents.lite_agent import LiteAgentManager


def test_send_speak_chunk_encodes_pcm_and_uses_agent_speak(monkeypatch):
    manager = LiteAgentManager()
    captured = {}

    async def fake_send_control(session_id, payload, require_ready=True):
        captured['session_id'] = session_id
        captured['payload'] = payload
        captured['require_ready'] = require_ready
        return {'ok': True}

    monkeypatch.setattr(manager, '_send_control', fake_send_control)

    pcm_chunk = b'\x01\x00\x02\x00'
    result = asyncio.run(manager.send_speak_chunk(session_id='session-1', pcm_chunk=pcm_chunk, event_id='evt-1'))

    assert result['ok'] is True
    assert captured['session_id'] == 'session-1'
    assert captured['require_ready'] is False
    assert captured['payload']['type'] == 'agent.speak'
    assert captured['payload']['event_id'] == 'evt-1'
    assert base64.b64decode(captured['payload']['audio']) == pcm_chunk


def test_send_speak_chunk_rejects_payloads_over_provider_limit(monkeypatch):
    manager = LiteAgentManager()

    async def fake_send_control(session_id, payload, require_ready=True):
        raise AssertionError('send_control should not be called for oversized chunk')

    monkeypatch.setattr(manager, '_send_control', fake_send_control)

    # 800k raw PCM encodes to >1MB base64 and should be rejected early.
    oversized_pcm_chunk = b'\x00' * 800_000
    result = asyncio.run(manager.send_speak_chunk(session_id='session-1', pcm_chunk=oversized_pcm_chunk, event_id='evt-1'))

    assert result['ok'] is False
    assert '1MB encoded payload limit' in str(result['error'])

