import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from app.audio.pcm import b64_encode_pcm_chunk, chunk_pcm_bytes


@dataclass
class LiteAgentState:
    session_id: str
    ws_url: str
    ws_connected: bool = False
    session_state: str = 'connecting'
    livekit_state: str = 'unknown'
    last_error: Optional[str] = None
    keepalive_running: bool = False
    ready: bool = False
    last_event_type: Optional[str] = None
    _recv_task: Optional[asyncio.Task[Any]] = field(default=None, repr=False)
    _keepalive_task: Optional[asyncio.Task[Any]] = field(default=None, repr=False)
    _ws: Any = field(default=None, repr=False)
    _ready_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    _send_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


class LiteAgentManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, LiteAgentState] = {}
        self._manager_lock = asyncio.Lock()

    async def register_session(self, *, session_id: str, ws_url: str) -> LiteAgentState:
        async with self._manager_lock:
            existing = self._sessions.get(session_id)
            if existing:
                await self.close_session(session_id)
            state = LiteAgentState(session_id=session_id, ws_url=ws_url)
            self._sessions[session_id] = state
        await self._connect_ws(state)
        return state

    def get_status(self, session_id: str) -> Dict[str, Any]:
        state = self._sessions.get(session_id)
        if not state:
            return {'exists': False}
        return {
            'exists': True,
            'session_id': state.session_id,
            'ws_connected': state.ws_connected,
            'session_state': state.session_state,
            'livekit_state': state.livekit_state,
            'last_error': state.last_error,
            'ready': state.ready,
            'last_event_type': state.last_event_type,
        }

    async def close_session(self, session_id: str) -> None:
        state = self._sessions.pop(session_id, None)
        if not state:
            return
        await self._shutdown_state(state)

    async def send_interrupt(self, session_id: str) -> Dict[str, Any]:
        return await self._send_control(session_id, {'type': 'agent.interrupt'})

    async def start_listening(self, session_id: str) -> Dict[str, Any]:
        return await self._send_control(session_id, {'type': 'agent.start_listening', 'event_id': _event_id()})

    async def stop_listening(self, session_id: str) -> Dict[str, Any]:
        return await self._send_control(session_id, {'type': 'agent.stop_listening', 'event_id': _event_id()})

    async def keep_alive(self, session_id: str) -> Dict[str, Any]:
        return await self._send_control(session_id, {'type': 'session.keep_alive', 'event_id': _event_id()})

    async def speak_pcm(self, session_id: str, pcm_audio: bytes, *, seconds_per_chunk: float = 1.0) -> Dict[str, Any]:
        state = self._sessions.get(session_id)
        if not state:
            return {'ok': False, 'error': 'session not registered'}
        ready = await self._wait_until_ready(state)
        if not ready:
            return {'ok': False, 'error': 'session not ready for speak'}

        event_id = _event_id()
        sent_chunks = 0
        for chunk in chunk_pcm_bytes(pcm_audio, sample_rate_hz=24000, seconds_per_chunk=seconds_per_chunk):
            encoded = b64_encode_pcm_chunk(chunk)
            if len(encoded.encode('utf-8')) > 1_000_000:
                return {'ok': False, 'error': 'audio chunk exceeds 1MB encoded payload limit'}
            result = await self._send_control(
                session_id,
                {'type': 'agent.speak', 'audio': encoded, 'event_id': event_id},
                require_ready=False,
            )
            if not result.get('ok'):
                return result
            sent_chunks += 1
        end_result = await self._send_control(
            session_id,
            {'type': 'agent.speak_end', 'event_id': event_id},
            require_ready=False,
        )
        if not end_result.get('ok'):
            return end_result
        return {'ok': True, 'event_id': event_id, 'chunk_count': sent_chunks}

    async def _connect_ws(self, state: LiteAgentState) -> None:
        try:
            state._ws = await ws_connect(state.ws_url)
            state.ws_connected = True
            state.keepalive_running = True
            state._recv_task = asyncio.create_task(self._recv_loop(state))
            state._keepalive_task = asyncio.create_task(self._keepalive_loop(state))
        except Exception as exc:
            state.last_error = str(exc)
            state.ws_connected = False

    async def _recv_loop(self, state: LiteAgentState) -> None:
        try:
            while True:
                raw = await state._ws.recv()
                try:
                    data = json.loads(raw)
                except Exception:
                    continue
                event_type = str(data.get('type') or '')
                state.last_event_type = event_type
                if event_type == 'session.state_updated':
                    session_state = str(data.get('state') or '').lower()
                    state.session_state = session_state
                    if session_state == 'connected':
                        state.ready = True
                        state._ready_event.set()
                    elif session_state in ('closing', 'closed'):
                        state.ready = False
                        state._ready_event.clear()
                elif event_type == 'agent.speak_started':
                    state.livekit_state = 'speaking'
                elif event_type == 'agent.speak_ended':
                    state.livekit_state = 'idle'
        except ConnectionClosed:
            state.ws_connected = False
            state.ready = False
            state._ready_event.clear()
        except Exception as exc:
            state.last_error = str(exc)
            state.ws_connected = False
            state.ready = False
            state._ready_event.clear()

    async def _keepalive_loop(self, state: LiteAgentState) -> None:
        while state.keepalive_running and state.ws_connected:
            await asyncio.sleep(90)
            await self._send_control(
                state.session_id,
                {'type': 'session.keep_alive', 'event_id': _event_id()},
                require_ready=False,
            )

    async def _wait_until_ready(self, state: LiteAgentState, timeout_seconds: float = 12.0) -> bool:
        if state.ready:
            return True
        try:
            await asyncio.wait_for(state._ready_event.wait(), timeout=timeout_seconds)
            return state.ready
        except asyncio.TimeoutError:
            return False

    async def _send_control(self, session_id: str, payload: Dict[str, Any], require_ready: bool = True) -> Dict[str, Any]:
        state = self._sessions.get(session_id)
        if not state:
            return {'ok': False, 'error': 'session not registered'}
        if not state.ws_connected or not state._ws:
            return {'ok': False, 'error': 'agent websocket is not connected'}
        if require_ready and not (state.ready or await self._wait_until_ready(state)):
            return {'ok': False, 'error': 'session state is not connected yet'}

        try:
            serialized = json.dumps(payload)
            async with state._send_lock:
                await state._ws.send(serialized)
            return {'ok': True}
        except Exception as exc:
            state.last_error = str(exc)
            return {'ok': False, 'error': str(exc)}

    async def _shutdown_state(self, state: LiteAgentState) -> None:
        state.keepalive_running = False
        state.ready = False
        state._ready_event.clear()
        for task in (state._recv_task, state._keepalive_task):
            if task:
                task.cancel()
        if state._ws:
            try:
                await state._ws.close()
            except Exception:
                pass
        state.ws_connected = False


def _event_id() -> str:
    return uuid.uuid4().hex


lite_agent_manager = LiteAgentManager()

