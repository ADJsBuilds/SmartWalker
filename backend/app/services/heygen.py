import logging
from typing import Any, Dict, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class HeyGenClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _is_configured(self) -> bool:
        """Check if HeyGen is properly configured."""
        return bool(
            self.settings.heygen_base_url
            and self.settings.heygen_api_key
            and self.settings.heygen_avatar_id
        )

    def _build_payload(self, text: str, voice_id: Optional[str] = None) -> Dict[str, Any]:
        """Build the proper HeyGen API payload format."""
        payload: Dict[str, Any] = {
            'avatar_id': self.settings.heygen_avatar_id,
            'text': text,
        }

        # Add voice_id if specified, otherwise let HeyGen use avatar default
        if voice_id or self.settings.heygen_voice_id:
            payload['voice_id'] = voice_id or self.settings.heygen_voice_id

        # For streaming mode, add additional parameters
        if self.settings.heygen_mode == 'streaming':
            payload['stream'] = True

        return payload

    def _extract_video_url(self, response_data: Dict[str, Any]) -> Optional[str]:
        """Extract video URL from HeyGen API response (handles various response formats)."""
        # Try common response structures
        if isinstance(response_data, dict):
            # Direct URL fields
            if 'url' in response_data and isinstance(response_data['url'], str):
                return response_data['url']
            if 'video_url' in response_data and isinstance(response_data['video_url'], str):
                return response_data['video_url']
            if 'download_url' in response_data and isinstance(response_data['download_url'], str):
                return response_data['download_url']

            # Nested in 'data' object
            if 'data' in response_data and isinstance(response_data['data'], dict):
                data = response_data['data']
                if 'url' in data and isinstance(data['url'], str):
                    return data['url']
                if 'video_url' in data and isinstance(data['video_url'], str):
                    return data['video_url']
                if 'download_url' in data and isinstance(data['download_url'], str):
                    return data['download_url']
                # For streaming, might return socket_url
                if 'socket_url' in data and isinstance(data['socket_url'], str):
                    return data['socket_url']

            # Nested in 'result' object
            if 'result' in response_data and isinstance(response_data['result'], dict):
                result = response_data['result']
                if 'url' in result and isinstance(result['url'], str):
                    return result['url']
                if 'video_url' in result and isinstance(result['video_url'], str):
                    return result['video_url']

        return None

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def generate_video(self, text: str, voice_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Generate a video from text using HeyGen avatar.

        Args:
            text: The text for the avatar to speak
            voice_id: Optional voice ID (overrides config default)

        Returns:
            Dict with 'success', 'video_url', 'mode', and 'raw' response
        """
        if not self._is_configured():
            logger.warning('HeyGen not fully configured (missing base_url, api_key, or avatar_id)')
            return {
                'success': False,
                'mode': 'fallback',
                'error': 'HeyGen not configured',
                'text': text,
            }

        payload = self._build_payload(text, voice_id)
        headers = {
            'Authorization': f'Bearer {self.settings.heygen_api_key}',
            'Content-Type': 'application/json',
        }

        try:
            timeout = httpx.Timeout(30.0)  # Video generation can take longer
            async with httpx.AsyncClient(timeout=timeout) as client:
                logger.info(f'Calling HeyGen API: {self.settings.heygen_base_url}')
                logger.debug(f'HeyGen payload: {payload}')

                response = await client.post(
                    self.settings.heygen_base_url,
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                response_data = response.json()

                logger.info(f'HeyGen API response status: {response.status_code}')

                # Extract video URL from response
                video_url = self._extract_video_url(response_data)

                if video_url:
                    logger.info(f'HeyGen video URL extracted: {video_url}')
                    return {
                        'success': True,
                        'mode': 'heygen',
                        'video_url': video_url,
                        'text': text,
                        'raw': response_data,
                    }
                else:
                    logger.warning(f'HeyGen response received but no video URL found. Response: {response_data}')
                    return {
                        'success': False,
                        'mode': 'fallback',
                        'error': 'No video URL in response',
                        'text': text,
                        'raw': response_data,
                    }

        except httpx.HTTPStatusError as e:
            logger.error(f'HeyGen API HTTP error: {e.response.status_code} - {e.response.text}')
            return {
                'success': False,
                'mode': 'fallback',
                'error': f'HTTP {e.response.status_code}: {e.response.text[:200]}',
                'text': text,
            }
        except httpx.RequestError as e:
            logger.error(f'HeyGen API request error: {e}')
            return {
                'success': False,
                'mode': 'fallback',
                'error': f'Request failed: {str(e)}',
                'text': text,
            }
        except Exception as e:
            logger.error(f'HeyGen API unexpected error: {e}', exc_info=True)
            return {
                'success': False,
                'mode': 'fallback',
                'error': f'Unexpected error: {str(e)}',
                'text': text,
            }

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def call(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generic HeyGen API call (for custom payloads).

        This method is kept for backward compatibility and custom use cases.
        For standard video generation, use generate_video() instead.
        """
        if not self.settings.heygen_base_url or not self.settings.heygen_api_key:
            logger.warning('HeyGen API not configured')
            return {'mode': 'fallback', 'detail': 'HEYGEN_BASE_URL or HEYGEN_API_KEY not configured', 'payload': payload}

        headers = {
            'Authorization': f'Bearer {self.settings.heygen_api_key}',
            'Content-Type': 'application/json',
        }
        timeout = httpx.Timeout(20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(self.settings.heygen_base_url, json=payload, headers=headers)
            response.raise_for_status()
            try:
                return response.json()
            except ValueError:
                return {'detail': 'HeyGen returned non-JSON response', 'raw_text': response.text}
