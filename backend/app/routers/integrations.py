import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.heygen import HeyGenClient
from app.services.openevidence import OpenEvidenceClient, normalize_openevidence

router = APIRouter(tags=['integrations'])
logger = logging.getLogger(__name__)


class OpenEvidencePayload(BaseModel):
    query: str
    metadata: Optional[Dict[str, Any]] = None


class HeyGenPayload(BaseModel):
    payload: Dict[str, Any]


class HeyGenSpeakPayload(BaseModel):
    text: str
    residentId: Optional[str] = None
    voiceId: Optional[str] = None  # Optional override for voice selection


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
    """
    Generic HeyGen API proxy endpoint for custom payloads.
    Use /api/heygen/speak for standard avatar video generation.
    """
    client = HeyGenClient()
    try:
        raw = await client.call(payload.payload)
        return {'raw': raw}
    except Exception as exc:
        logger.error(f'HeyGen proxy call failed: {exc}', exc_info=True)
        raise HTTPException(status_code=502, detail=f'heygen request failed: {exc}')


@router.get('/api/heygen/avatars')
async def list_heygen_avatars():
    """
    List available HeyGen avatars.
    
    This endpoint attempts to fetch available avatars from HeyGen's API.
    Note: This requires HEYGEN_API_KEY to be configured.
    """
    client = HeyGenClient()
    
    if not client.settings.heygen_api_key:
        raise HTTPException(status_code=400, detail='HEYGEN_API_KEY not configured')
    
    try:
        # Try common HeyGen API endpoints for listing avatars
        headers = {
            'Authorization': f'Bearer {client.settings.heygen_api_key}',
            'Content-Type': 'application/json',
        }
        
        import httpx
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as http_client:
            # Try the avatars endpoint
            try:
                response = await http_client.get(
                    'https://api.heygen.com/v1/avatars',
                    headers=headers,
                )
                if response.status_code == 200:
                    return {'avatars': response.json(), 'source': 'api.heygen.com/v1/avatars'}
            except Exception:
                pass
            
            # Alternative: try avatar list endpoint
            try:
                response = await http_client.get(
                    'https://api.heygen.com/v1/avatar/list',
                    headers=headers,
                )
                if response.status_code == 200:
                    return {'avatars': response.json(), 'source': 'api.heygen.com/v1/avatar/list'}
            except Exception:
                pass
        
        # If API endpoints don't work, return guidance
        return {
            'message': 'Could not fetch avatars from API. Check HeyGen dashboard directly.',
            'guidance': {
                'how_to_find': '1. Log into HeyGen dashboard\n2. Go to Avatars section\n3. Browse available avatars\n4. Copy the Avatar ID from the avatar details',
                'recommended_characteristics': [
                    'Professional appearance (business casual or medical attire)',
                    'Warm, approachable demeanor',
                    'Clear speech and articulation',
                    'Age: 30-50 years (conveys experience)',
                    'Gender: Consider diverse representation',
                ],
                'suggested_search_terms': ['professional', 'coach', 'therapist', 'healthcare', 'medical', 'instructor'],
            },
        }
    except Exception as exc:
        logger.error(f'Error fetching HeyGen avatars: {exc}', exc_info=True)
        raise HTTPException(status_code=502, detail=f'Failed to fetch avatars: {exc}')


@router.post('/api/heygen/speak', response_model=HeyGenSpeakResponse)
async def heygen_speak(payload: HeyGenSpeakPayload):
    """
    Generate HeyGen avatar video from text.

    This endpoint:
    1. Takes text and optional voice_id
    2. Calls HeyGen API with proper avatar configuration
    3. Returns video URL or fallback response

    Response format:
    - Success: {mode: 'heygen', video_url: '...', text: '...', raw: {...}}
    - Fallback: {mode: 'fallback', text: '...', error: '...'}
    """
    client = HeyGenClient()
    logger.info(f'HeyGen speak request: text length={len(payload.text)}, residentId={payload.residentId}')

    result = await client.generate_video(payload.text, payload.voiceId)

    # Return in format expected by frontend
    if result.get('success'):
        return {
            'ok': True,
            'mode': 'heygen',
            'text': payload.text,
            'residentId': payload.residentId,
            'videoUrl': result.get('video_url'),
            'audioUrl': None,  # Audio URL extraction can be added if needed
            'providerStatus': None,  # Provider status extraction can be added if needed
            'raw': result.get('raw', {}),
        }
    else:
        # Fallback mode - frontend will use browser TTS
        logger.warning(f'HeyGen video generation failed: {result.get("error")}')
        return {
            'ok': False,
            'mode': 'fallback',
            'text': payload.text,
            'residentId': payload.residentId,
            'error': result.get('error', 'Unknown error'),
            'raw': result.get('raw', {}),
        }
