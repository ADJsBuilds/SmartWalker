from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.heygen import HeyGenClient
from app.services.openevidence import OpenEvidenceClient, normalize_openevidence

router = APIRouter(tags=['integrations'])


class OpenEvidencePayload(BaseModel):
    query: str
    metadata: Optional[Dict[str, Any]] = None


class HeyGenPayload(BaseModel):
    payload: Dict[str, Any]


class HeyGenSpeakPayload(BaseModel):
    text: str
    residentId: Optional[str] = None


class HeyGenSpeakResponse(BaseModel):
    ok: bool
    mode: str
    text: str
    residentId: Optional[str] = None
    videoUrl: Optional[str] = None
    audioUrl: Optional[str] = None
    providerStatus: Optional[str] = None
    error: Optional[str] = None
    raw: Optional[Dict[str, Any]] = None


@router.post('/api/integrations/openevidence')
async def openevidence_proxy(payload: OpenEvidencePayload):
    client = OpenEvidenceClient()
    try:
        raw = await client.ask(payload.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'openevidence request failed: {exc}')
    return {'raw': raw, 'normalized': normalize_openevidence(raw if isinstance(raw, dict) else {})}


@router.post('/api/integrations/heygen')
async def heygen_proxy(payload: HeyGenPayload):
    client = HeyGenClient()
    try:
        raw = await client.call(payload.payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'heygen request failed: {exc}')
    return {'raw': raw}


@router.post('/api/heygen/speak', response_model=HeyGenSpeakResponse)
async def heygen_speak(payload: HeyGenSpeakPayload):
    client = HeyGenClient()
    try:
        raw = await client.call({'text': payload.text, 'residentId': payload.residentId})
        if isinstance(raw, dict) and raw.get('mode') == 'fallback':
            return {
                'ok': False,
                'mode': 'fallback',
                'text': payload.text,
                'residentId': payload.residentId,
                'error': str(raw.get('detail') or 'HeyGen config missing'),
                'raw': raw,
            }

        video_url, audio_url, provider_status = _extract_media(raw if isinstance(raw, dict) else {})
        return {
            'ok': True,
            'mode': 'heygen',
            'text': payload.text,
            'residentId': payload.residentId,
            'videoUrl': video_url,
            'audioUrl': audio_url,
            'providerStatus': provider_status,
            'raw': raw if isinstance(raw, dict) else {'raw': raw},
        }
    except Exception as exc:
        return {
            'ok': False,
            'mode': 'fallback',
            'text': payload.text,
            'residentId': payload.residentId,
            'error': str(exc),
            'raw': None,
        }


def _extract_media(raw: Dict[str, Any]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    video_url = _find_first_string(raw, {'videoUrl', 'video_url', 'url', 'download_url'})
    audio_url = _find_first_string(raw, {'audioUrl', 'audio_url'})
    provider_status = _find_first_string(raw, {'status', 'state'})
    return video_url, audio_url, provider_status


def _find_first_string(value: Any, keys: set[str]) -> Optional[str]:
    if isinstance(value, dict):
        for key, candidate in value.items():
            if key in keys and isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        for nested in value.values():
            hit = _find_first_string(nested, keys)
            if hit:
                return hit
    elif isinstance(value, list):
        for item in value:
            hit = _find_first_string(item, keys)
            if hit:
                return hit
    return None
