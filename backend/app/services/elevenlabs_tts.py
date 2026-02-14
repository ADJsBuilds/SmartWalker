import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class ElevenLabsTTSService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _api_key(self) -> str:
        return (self.settings.elevenlabs_api_key or '').strip()

    def _base_url(self) -> str:
        return (self.settings.elevenlabs_base_url or 'https://api.elevenlabs.io').rstrip('/')

    def _default_voice_id(self) -> str:
        return (self.settings.elevenlabs_voice_id or '').strip()

    def _default_model_id(self) -> str:
        return (self.settings.elevenlabs_model_id or 'eleven_multilingual_v2').strip()

    def _output_format(self) -> str:
        return (self.settings.elevenlabs_output_format or 'pcm_24000').strip()

    async def synthesize_pcm24(
        self,
        *,
        text: str,
        voice_id: Optional[str] = None,
        model_id: Optional[str] = None,
        voice_settings: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        api_key = self._api_key()
        resolved_voice_id = (voice_id or self._default_voice_id()).strip()
        if not api_key:
            return {'ok': False, 'error': 'ELEVENLABS_API_KEY not configured'}
        if not resolved_voice_id:
            return {'ok': False, 'error': 'ELEVENLABS_VOICE_ID not configured'}
        if not text.strip():
            return {'ok': False, 'error': 'text is required'}

        resolved_model_id = (model_id or self._default_model_id()).strip()
        payload: Dict[str, Any] = {'text': text.strip(), 'model_id': resolved_model_id}
        if voice_settings:
            payload['voice_settings'] = voice_settings

        headers = {
            'xi-api-key': api_key,
            'accept': 'application/octet-stream',
            'Content-Type': 'application/json',
        }
        params = {'output_format': self._output_format()}
        urls = [
            f'{self._base_url()}/v1/text-to-speech/{resolved_voice_id}/stream',
            f'{self._base_url()}/v1/text-to-speech/{resolved_voice_id}',
        ]

        async with httpx.AsyncClient(timeout=httpx.Timeout(35.0)) as client:
            last_error = 'unknown'
            for url in urls:
                try:
                    response = await client.post(url, headers=headers, params=params, json=payload)
                    response.raise_for_status()
                    audio_bytes = response.content
                    if not audio_bytes:
                        return {'ok': False, 'error': 'ElevenLabs returned empty audio response'}
                    return {'ok': True, 'pcm': audio_bytes}
                except httpx.HTTPStatusError as exc:
                    status = exc.response.status_code
                    body = (exc.response.text or '')[:300]
                    logger.warning('ElevenLabs TTS failed: status=%s url=%s body=%s', status, url, body)
                    last_error = f'HTTP {status}: {body or "request failed"}'
                    if status in (404, 405):
                        continue
                    return {'ok': False, 'error': last_error}
                except httpx.RequestError as exc:
                    logger.error('ElevenLabs request error: %s', exc)
                    last_error = str(exc)
                    continue
            return {'ok': False, 'error': f'Unable to synthesize speech. Last error: {last_error}'}

