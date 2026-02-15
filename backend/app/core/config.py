import json
from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore',
        enable_decoding=False,
    )

    app_env: str = 'local'
    database_url: str = 'sqlite:///./data/app.db'
    storage_dir: str = './data'
    heygen_api_key: str = ''
    liveagent_api_key: str = ''
    liveavatar_api_key: str = ''
    elevenlabs_api_key: str = ''
    elevenlabs_agent_id: str = ''
    elevenlabs_base_url: str = 'https://api.elevenlabs.io'
    elevenlabs_voice_id: str = ''
    elevenlabs_model_id: str = 'eleven_multilingual_v2'
    elevenlabs_output_format: str = 'pcm_24000'
    openevidence_api_key: str = ''
    openevidence_base_url: str = ''
    gemini_api_key: str = ''
    gemini_enabled: bool = False
    gemini_model: str = 'gemini-3-flash'
    gemini_base_url: str = 'https://generativelanguage.googleapis.com/v1beta'
    coach_script_cooldown_seconds: int = 8
    heygen_base_url: str = ''
    liveagent_base_url: str = 'https://api.liveavatar.com'
    liveavatar_base_url: str = 'https://api.liveavatar.com'
    heygen_avatar_id: str = ''  # HeyGen avatar ID (required for avatar generation)
    heygen_voice_id: str = ''  # Optional: specific voice ID, otherwise uses avatar default
    heygen_mode: str = 'video'  # 'video' for video generation, 'streaming' for real-time streaming
    liveagent_avatar_id: str = ''
    liveagent_voice_id: str = ''
    liveagent_language: str = 'en'
    liveagent_interactivity_type: str = 'PUSH_TO_TALK'
    liveagent_is_sandbox: bool = False
    liveavatar_avatar_id: str = ''
    liveavatar_language: str = 'en'
    liveavatar_interactivity_type: str = 'PUSH_TO_TALK'
    include_provider_raw: bool = False
    openai_api_key: str = Field(default='', validation_alias='OPENAI_API_KEY')
    openai_base_url: str = Field(default='https://api.openai.com/v1', validation_alias='OPENAI_BASE_URL')
    openai_stt_model: str = 'gpt-4o-mini-transcribe'
    openai_sql_model: str = 'gpt-4o-mini'
    openai_answer_model: str = 'gpt-4o-mini'
    openai_tts_model: str = 'gpt-4o-mini-tts'
    openai_tts_voice: str = 'nova'
    openai_max_rows_per_query: int = 30
    openai_enable_template_sql: bool = True
    openai_sql_cache_ttl_seconds: int = 20
    voice_action_confirmation_timeout_seconds: int = 20
    voice_action_enable_llm_fallback: bool = False
    ingest_persist_interval_seconds: int = 5
    ingest_risk_persist_interval_seconds: int = 1
    ingest_store_full_payload_every_n_samples: int = 3
    ingest_allowed_resident_id: str = 'r_1'
    ingest_dedupe_window_ms: int = 250
    ingest_realtime_summary_max_age_seconds: int = 8
    retention_enabled: bool = True
    retention_run_interval_seconds: int = 3600
    retention_metric_samples_days: int = 14
    retention_exercise_metric_samples_days: int = 30
    retention_ingest_events_days: int = 60
    retention_walking_sessions_days: int = 90
    retention_hourly_rollups_days: int = 90
    retention_daily_rollups_days: int = 365
    retention_daily_reports_days: int = 365
    cors_allow_origins: List[str] = ['*']
    log_level: str = 'INFO'

    # Carrier mode: Zoom + email invites
    zoom_account_id: str = ''
    zoom_client_id: str = ''
    zoom_client_secret: str = ''
    zoom_secret_token: str = ''
    carrier_email_from: str = ''
    carrier_email_app_password: str = ''
    carrier_contacts: str = '{}'

    @field_validator('carrier_contacts', mode='before')
    @classmethod
    def parse_carrier_contacts(cls, value):
        if value is None or value == '':
            return '{}'
        if isinstance(value, str):
            try:
                obj = json.loads(value)
                if isinstance(obj, dict):
                    return json.dumps({str(k).strip().lower(): str(v).strip() for k, v in obj.items()})
            except json.JSONDecodeError:
                pass
            return value
        return '{}'

    @field_validator('cors_allow_origins', mode='before')
    @classmethod
    def parse_origins(cls, value):
        if value is None:
            return ['*']

        if isinstance(value, str):
            raw = value.strip()
            if not raw or raw == '*':
                return ['*']

            # Accept JSON list format from env, e.g. ["http://localhost:3000"]
            try:
                decoded = json.loads(raw)
                if isinstance(decoded, list):
                    return [str(v).strip() for v in decoded if str(v).strip()]
                if isinstance(decoded, str) and decoded.strip():
                    return [decoded.strip()]
            except json.JSONDecodeError:
                pass

            # Accept bracketed or comma-separated values, e.g. [a,b] or a,b
            if raw.startswith('[') and raw.endswith(']'):
                raw = raw[1:-1]
            parts = [p.strip().strip('"').strip("'") for p in raw.split(',') if p.strip()]
            return parts or ['*']

        if isinstance(value, (list, tuple, set)):
            return [str(v).strip() for v in value if str(v).strip()]

        return ['*']


@lru_cache
def get_settings() -> Settings:
    return Settings()
