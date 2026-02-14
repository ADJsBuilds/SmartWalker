"""
Carrier mode API: Zoom meeting creation and email invite.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.services.carrier import (
    create_zoom_meeting,
    parse_phrase_to_label,
    resolve_contact,
    send_meeting_email,
)

router = APIRouter(tags=['carrier'])
logger = logging.getLogger(__name__)


class ZoomInvitePayload(BaseModel):
    contactLabel: Optional[str] = None
    phrase: Optional[str] = None


@router.post('/api/carrier/zoom-invite')
def zoom_invite(payload: ZoomInvitePayload):
    """
    Resolve contact from label or phrase, create a Zoom meeting, and email the join link.
    """
    settings = get_settings()
    contact_label: Optional[str] = None

    if payload.contactLabel and payload.contactLabel.strip():
        contact_label = payload.contactLabel.strip()
    elif payload.phrase and payload.phrase.strip():
        contact_label = parse_phrase_to_label(payload.phrase)
        if not contact_label:
            raise HTTPException(
                status_code=400,
                detail="Phrase must be like 'Zoom my physical therapist' or 'Zoom my daughter'.",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either contactLabel or phrase.",
        )

    try:
        email = resolve_contact(settings, contact_label)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        join_url = create_zoom_meeting(settings, contact_label)
    except ValueError as e:
        logger.warning("Zoom config/request error: %s", e)
        raise HTTPException(status_code=502, detail="Zoom is not configured or request failed.") from e
    except Exception as e:
        logger.exception("Zoom API error")
        raise HTTPException(status_code=502, detail="Failed to create Zoom meeting.") from e

    try:
        send_meeting_email(settings, email, join_url, contact_label)
    except ValueError as e:
        logger.warning("Email config error: %s", e)
        raise HTTPException(status_code=502, detail="Email is not configured.") from e
    except Exception as e:
        logger.exception("SMTP error")
        raise HTTPException(status_code=503, detail="Failed to send email.") from e

    return {
        "ok": True,
        "joinUrl": join_url,
        "sentTo": email,
    }
