import json
from functools import lru_cache
from typing import List

from pydantic import field_validator
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
    openevidence_api_key: str = ''
    openevidence_base_url: str = ''
    heygen_base_url: str = ''
    liveagent_base_url: str = 'https://api.heygen.com'
    heygen_avatar_id: str = ''  # HeyGen avatar ID (required for avatar generation)
    heygen_voice_id: str = ''  # Optional: specific voice ID, otherwise uses avatar default
    heygen_mode: str = 'video'  # 'video' for video generation, 'streaming' for real-time streaming
    liveagent_avatar_id: str = ''
    liveagent_voice_id: str = ''
    liveagent_language: str = 'en'
    liveagent_interactivity_type: str = 'PUSH_TO_TALK'
    liveagent_is_sandbox: bool = False
    cors_allow_origins: List[str] = ['*']
    log_level: str = 'INFO'

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
