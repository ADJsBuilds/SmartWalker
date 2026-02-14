"""
Carrier mode: contact resolution, Zoom meeting creation, and email delivery.
"""
import json
import logging
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Tuple

import httpx

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

# In-memory cache for Zoom access token (token_string, expires_at_ts)
_zoom_token_cache: Optional[Tuple[str, float]] = None
ZOOM_TOKEN_EXPIRY_BUFFER_SECONDS = 300  # refresh 5 min before expiry


def resolve_contact(settings: Settings, contact_label: str) -> str:
    """
    Resolve a contact label (e.g. 'physical therapist', 'daughter') to an email.
    Raises ValueError if contact not found.
    """
    raw = settings.carrier_contacts or '{}'
    try:
        contacts = json.loads(raw)
    except json.JSONDecodeError:
        contacts = {}
    if not isinstance(contacts, dict):
        contacts = {}
    normalized = contact_label.strip().lower()
    if not normalized:
        raise ValueError("Contact label is empty")
    email = contacts.get(normalized)
    if not email or not str(email).strip():
        raise ValueError(f"Contact '{contact_label}' not found")
    return str(email).strip()


def parse_phrase_to_label(phrase: str) -> Optional[str]:
    """
    Parse a phrase like "Zoom my physical therapist" or "zoom my daughter" to the contact label.
    Returns None if the phrase doesn't match.
    """
    if not phrase or not phrase.strip():
        return None
    text = phrase.strip().lower()
    prefix = "zoom my "
    if not text.startswith(prefix):
        return None
    label = text[len(prefix) :].strip()
    return label if label else None


def get_zoom_access_token(settings: Settings) -> str:
    """
    Obtain a Zoom Server-to-Server OAuth access token, using a simple in-memory cache.
    """
    global _zoom_token_cache
    now = time.time()
    if _zoom_token_cache is not None:
        token, expires_at = _zoom_token_cache
        if expires_at > now + ZOOM_TOKEN_EXPIRY_BUFFER_SECONDS:
            return token

    account_id = (settings.zoom_account_id or "").strip()
    client_id = (settings.zoom_client_id or "").strip()
    client_secret = (settings.zoom_client_secret or "").strip()
    if not account_id or not client_id or not client_secret:
        missing = []
        if not account_id:
            missing.append("ZOOM_ACCOUNT_ID")
        if not client_id:
            missing.append("ZOOM_CLIENT_ID")
        if not client_secret:
            missing.append("ZOOM_CLIENT_SECRET")
        raise ValueError(
            "Zoom is not configured. In Render → Environment, set: " + ", ".join(missing)
        )

    import base64
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    with httpx.Client() as client:
        resp = client.post(
            "https://zoom.us/oauth/token",
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "account_credentials", "account_id": account_id},
            timeout=15.0,
        )
    resp.raise_for_status()
    data = resp.json()
    access_token = data.get("access_token")
    expires_in = int(data.get("expires_in", 3600))
    if not access_token:
        raise ValueError("Zoom token response missing access_token")
    expires_at = now + expires_in
    _zoom_token_cache = (access_token, expires_at)
    return access_token


def create_zoom_meeting(settings: Settings, contact_label: str) -> str:
    """
    Create an instant Zoom meeting and return the join_url.
    """
    token = get_zoom_access_token(settings)
    topic = f"SmartWalker Zoom with {contact_label}"
    with httpx.Client() as client:
        resp = client.post(
            "https://api.zoom.us/v2/users/me/meetings",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "topic": topic,
                "type": 1,
                "duration": 60,
            },
            timeout=15.0,
        )
    resp.raise_for_status()
    data = resp.json()
    join_url = data.get("join_url")
    if not join_url:
        raise ValueError("Zoom create meeting response missing join_url")
    return join_url


def send_meeting_email(settings: Settings, to_email: str, join_url: str, contact_label: str) -> None:
    """
    Send an email with the Zoom meeting link via Gmail SMTP.
    """
    from_email = (settings.carrier_email_from or "").strip()
    password = (settings.carrier_email_app_password or "").strip()
    if not from_email or not password:
        raise ValueError("Carrier email not configured (carrier_email_from, carrier_email_app_password)")

    subject = "SmartWalker Zoom meeting – join link"
    body_text = f"""You're invited to a Zoom call from SmartWalker.

Join here: {join_url}

This link was requested for the contact: {contact_label}.
"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(body_text, "plain"))

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(from_email, password)
        server.sendmail(from_email, [to_email], msg.as_string())
    logger.info("Carrier email sent to %s with Zoom link", to_email)
