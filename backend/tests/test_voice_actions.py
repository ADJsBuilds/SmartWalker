from types import SimpleNamespace

from app.services.voice_actions import VoiceActionRouter, parse_confirmation


def _settings(enable_llm_fallback: bool = False):
    return SimpleNamespace(
        voice_action_enable_llm_fallback=enable_llm_fallback,
        openai_api_key='',
        openai_answer_model='gpt-4o-mini',
        openai_sql_model='gpt-4o-mini',
        openai_base_url='https://api.openai.com/v1',
    )


def test_deterministic_zoom_my_phrase():
    router = VoiceActionRouter(settings=_settings())
    candidate = router.detect_zoom_action_deterministic("Zoom my daughter's physical therapist")
    assert candidate is not None
    assert candidate.action_type == 'zoom_invite'
    assert candidate.contact_label == "daughter's physical therapist"
    assert candidate.source == 'deterministic'


def test_deterministic_variants():
    router = VoiceActionRouter(settings=_settings())
    candidate = router.detect_zoom_action_deterministic('Please schedule a zoom meeting with my daughter')
    assert candidate is not None
    assert candidate.contact_label == 'daughter'

    candidate_2 = router.detect_zoom_action_deterministic('Call my physical therapist on zoom')
    assert candidate_2 is not None
    assert candidate_2.contact_label == 'physical therapist'


def test_parse_confirmation_tokens():
    assert parse_confirmation('yes please send it') == 'confirm'
    assert parse_confirmation('no cancel that') == 'deny'
    assert parse_confirmation('what was my step count today') == 'unknown'

