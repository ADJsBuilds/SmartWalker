from typing import Any, Dict

import httpx
from tenacity import retry, stop_after_attempt, wait_fixed

from app.core.config import get_settings


class OpenEvidenceClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(1), reraise=True)
    async def ask(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self.settings.openevidence_base_url:
            return {'mode': 'fallback', 'detail': 'OPENEVIDENCE_BASE_URL not configured'}

        headers = {'Authorization': f'Bearer {self.settings.openevidence_api_key}'} if self.settings.openevidence_api_key else {}
        timeout = httpx.Timeout(15.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(self.settings.openevidence_base_url, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()


def normalize_openevidence(raw: Dict[str, Any]) -> Dict[str, Any]:
    findings = []
    citations = []

    if isinstance(raw, dict):
        if isinstance(raw.get('findings'), list):
            findings = raw['findings']
        if isinstance(raw.get('citations'), list):
            citations = raw['citations']

    return {'findings': findings, 'citations': citations}
