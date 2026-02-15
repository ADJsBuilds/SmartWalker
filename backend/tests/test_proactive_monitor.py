from types import SimpleNamespace

import pytest

from app.services.proactive_monitor import ProactiveEvent, ProactiveMonitorService
import app.services.proactive_monitor as proactive_module


def _settings():
    return SimpleNamespace(
        proactive_monitor_enabled=True,
        proactive_weight_threshold_kg=20.0,
        proactive_balance_threshold=0.30,
        proactive_event_cooldown_seconds=30,
        proactive_max_speaks_per_minute=4,
        proactive_require_active_avatar=True,
        openai_api_key='',
        openai_answer_model='gpt-4o-mini',
        openai_sql_model='gpt-4o-mini',
        openai_base_url='https://api.openai.com/v1',
        voice_action_enable_llm_fallback=False,
        elevenlabs_api_key='',
        elevenlabs_voice_id='',
        elevenlabs_model_id='eleven_multilingual_v2',
        elevenlabs_base_url='https://api.elevenlabs.io',
        elevenlabs_output_format='pcm_24000',
    )


def test_collect_events_from_thresholds():
    monitor = ProactiveMonitorService(settings=_settings())
    merged = {
        'ts': 100,
        'metrics': {
            'fallSuspected': True,
            'reliance': 24.5,
            'balance': 0.51,
        },
    }
    events = monitor._collect_events(resident_id='r1', merged=merged, ts=100)
    kinds = {e.event_type for e in events}
    assert {'fall', 'high_load', 'imbalance'} == kinds


def test_event_cooldown_and_dedupe():
    monitor = ProactiveMonitorService(settings=_settings())
    event = ProactiveEvent(
        resident_id='r1',
        event_type='imbalance',
        severity='medium',
        metrics_snapshot={'balance': 0.41, 'reliance': 10},
        ts=100,
    )
    assert monitor._should_enqueue(event) is True
    event_same_window = ProactiveEvent(
        resident_id='r1',
        event_type='imbalance',
        severity='medium',
        metrics_snapshot={'balance': 0.41, 'reliance': 10},
        ts=110,
    )
    assert monitor._should_enqueue(event_same_window) is False
    event_after_cooldown = ProactiveEvent(
        resident_id='r1',
        event_type='imbalance',
        severity='medium',
        metrics_snapshot={'balance': 0.55, 'reliance': 10},
        ts=150,
    )
    assert monitor._should_enqueue(event_after_cooldown) is True


@pytest.mark.asyncio
async def test_process_event_broadcasts_without_avatar_session():
    monitor = ProactiveMonitorService(settings=_settings())
    emitted = []

    async def fake_broadcast_all(payload):
        emitted.append(payload)

    async def fake_broadcast_resident(_resident_id, payload):
        emitted.append(payload)

    monitor.configure_broadcasts(broadcast_all=fake_broadcast_all, broadcast_resident=fake_broadcast_resident)

    async def fake_message(**_kwargs):
        return 'Safety reminder.'

    monitor._router.generate_proactive_message = fake_message
    await monitor._process_event(
        ProactiveEvent(
            resident_id='r1',
            event_type='high_load',
            severity='medium',
            metrics_snapshot={'reliance': 21.0},
            ts=123,
        )
    )
    assert emitted
    assert all(e.get('type') == 'proactive_event' for e in emitted)
    assert any(e.get('spoken') is False for e in emitted)


@pytest.mark.asyncio
async def test_process_event_speaks_when_avatar_session_exists(monkeypatch):
    monitor = ProactiveMonitorService(settings=_settings())
    monitor.set_resident_session('r1', 'sess_1')
    spoken_payloads = []

    async def fake_broadcast_all(payload):
        spoken_payloads.append(payload)

    async def fake_broadcast_resident(_resident_id, payload):
        spoken_payloads.append(payload)

    monitor.configure_broadcasts(broadcast_all=fake_broadcast_all, broadcast_resident=fake_broadcast_resident)

    async def fake_message(**_kwargs):
        return 'I am concerned about a possible fall. Do you want me to call for help?'

    async def fake_tts(*, text: str, **_kwargs):
        assert 'help' in text.lower()
        return {'ok': True, 'pcm': b'\x00\x00'}

    interrupt_called = {'value': False}

    async def fake_interrupt(_session_id: str):
        interrupt_called['value'] = True
        return {'ok': True}

    async def fake_speak_pcm(_session_id: str, _pcm: bytes):
        return {'ok': True}

    monitor._router.generate_proactive_message = fake_message
    monitor._tts.synthesize_pcm24 = fake_tts
    monkeypatch.setattr(proactive_module.lite_agent_manager, 'send_interrupt', fake_interrupt)
    monkeypatch.setattr(proactive_module.lite_agent_manager, 'speak_pcm', fake_speak_pcm)

    await monitor._process_event(
        ProactiveEvent(
            resident_id='r1',
            event_type='fall',
            severity='high',
            metrics_snapshot={'fallSuspected': True},
            ts=456,
        )
    )
    assert interrupt_called['value'] is True
    assert any(e.get('spoken') is True for e in spoken_payloads)

