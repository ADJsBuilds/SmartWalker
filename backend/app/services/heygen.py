from typing import Any, Dict

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings


class HeyGenClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def call(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.settings.heygen_base_url:
            return {'mode': 'fallback', 'detail': 'HEYGEN_BASE_URL not configured', 'payload': payload}
        if not self.settings.heygen_api_key:
            return {'mode': 'fallback', 'detail': 'HEYGEN_API_KEY not configured', 'payload': payload}

        headers = {'Authorization': f'Bearer {self.settings.heygen_api_key}'} if self.settings.heygen_api_key else {}
        timeout = httpx.Timeout(20.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(self.settings.heygen_base_url, json=payload, headers=headers)
            response.raise_for_status()
            try:
                return response.json()
            except ValueError:
                return {'detail': 'HeyGen returned non-JSON response', 'raw_text': response.text}
