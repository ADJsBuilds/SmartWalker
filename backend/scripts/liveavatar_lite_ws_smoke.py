#!/usr/bin/env python3
"""
Minimal LITE-mode smoke test:
1) Create token
2) Start session
3) Open ws_url
4) Wait for session.state_updated == connected
5) Send 1 second test tone via agent.speak chunks + speak_end
"""

import asyncio
import base64
import json
import math
import os
import struct
import sys
import uuid
from typing import Dict

import httpx
from websockets.asyncio.client import connect as ws_connect


def build_tone_pcm16le(sample_rate: int = 24000, duration_sec: float = 1.0, hz: float = 440.0) -> bytes:
    n = max(1, int(sample_rate * duration_sec))
    out = bytearray()
    for i in range(n):
        t = i / float(sample_rate)
        val = 0.2 * math.sin(2.0 * math.pi * hz * t)
        out.extend(struct.pack('<h', int(max(-1.0, min(1.0, val)) * 32767)))
    return bytes(out)


def chunk_bytes(buf: bytes, chunk_size: int = 48000):
    for i in range(0, len(buf), chunk_size):
        yield buf[i : i + chunk_size]


async def create_token(base_url: str, api_key: str, avatar_id: str) -> Dict[str, str]:
    payload = {
        'mode': 'LITE',
        'avatar_id': avatar_id,
        'avatar_persona': {'language': 'en'},
        'video_settings': {'encoding': 'VP8', 'quality': 'high'},
        'is_sandbox': False,
    }
    headers = {'X-API-KEY': api_key, 'Content-Type': 'application/json', 'accept': 'application/json'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
        resp = await client.post(f'{base_url}/v1/sessions/token', json=payload, headers=headers)
        resp.raise_for_status()
        raw = resp.json()
    data = raw.get('data') or {}
    return {'session_id': data.get('session_id'), 'session_token': data.get('session_token')}


async def start_session(base_url: str, session_token: str) -> Dict[str, str]:
    headers = {'authorization': f'Bearer {session_token}', 'Content-Type': 'application/json', 'accept': 'application/json'}
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
        resp = await client.post(f'{base_url}/v1/sessions/start', json={}, headers=headers)
        resp.raise_for_status()
        raw = resp.json()
    data = raw.get('data') or {}
    return {
        'session_id': data.get('session_id'),
        'ws_url': data.get('ws_url'),
    }


async def main() -> int:
    base_url = os.environ.get('LIVEAVATAR_BASE_URL', 'https://api.liveavatar.com').rstrip('/')
    api_key = os.environ.get('LIVEAVATAR_API_KEY', '').strip()
    avatar_id = os.environ.get('LIVEAVATAR_AVATAR_ID', '').strip()
    if not api_key or not avatar_id:
        print('Missing LIVEAVATAR_API_KEY or LIVEAVATAR_AVATAR_ID', file=sys.stderr)
        return 1

    token = await create_token(base_url, api_key, avatar_id)
    session_token = token.get('session_token') or ''
    session_id = token.get('session_id') or ''
    if not session_token or not session_id:
        print('Token response missing session_id/session_token', file=sys.stderr)
        return 1
    print(f'Created token for session_id={session_id}')

    started = await start_session(base_url, session_token)
    ws_url = started.get('ws_url') or ''
    if not ws_url:
        print('Start response missing ws_url', file=sys.stderr)
        return 1
    print(f'Started session, ws_url={ws_url}')

    event_id = uuid.uuid4().hex
    pcm = build_tone_pcm16le()
    async with ws_connect(ws_url) as ws:
        print('WebSocket connected, waiting for session.state_updated connected...')
        ready = False
        for _ in range(30):
            msg = await asyncio.wait_for(ws.recv(), timeout=8)
            data = json.loads(msg)
            if data.get('type') == 'session.state_updated' and str(data.get('state')).lower() == 'connected':
                ready = True
                print('Session state connected.')
                break
        if not ready:
            print('Timed out waiting for connected state.', file=sys.stderr)
            return 1

        for chunk in chunk_bytes(pcm):
            b64 = base64.b64encode(chunk).decode('ascii')
            await ws.send(json.dumps({'type': 'agent.speak', 'audio': b64, 'event_id': event_id}))
        await ws.send(json.dumps({'type': 'agent.speak_end', 'event_id': event_id}))
        print('Sent test tone via agent.speak + agent.speak_end')

    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))

