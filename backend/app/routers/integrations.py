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


@router.post('/api/heygen/speak')
async def heygen_speak(payload: HeyGenSpeakPayload):
    client = HeyGenClient()
    try:
        raw = await client.call({'text': payload.text, 'residentId': payload.residentId})
        return {'mode': 'heygen', 'text': payload.text, 'raw': raw}
    except Exception:
        return {'mode': 'fallback', 'text': payload.text}
