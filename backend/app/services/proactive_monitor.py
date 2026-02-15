import asyncio
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional

from app.agents.lite_agent import lite_agent_manager
from app.core.config import Settings, get_settings
from app.services.elevenlabs_tts import ElevenLabsTTSService
from app.services.voice_actions import VoiceActionRouter


@dataclass
class ProactiveEvent:
    resident_id: str
    event_type: str
    severity: str
    metrics_snapshot: Dict[str, Any]
    ts: int


class ProactiveMonitorService:
    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._queue: asyncio.Queue[ProactiveEvent] = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task[Any]] = None
        self._running = False

        self._router = VoiceActionRouter(settings=self.settings)
        self._tts = ElevenLabsTTSService()

        self._last_event_at: Dict[tuple[str, str], int] = {}
        self._last_event_signature: Dict[tuple[str, str], str] = {}
        self._last_speak_by_resident: Dict[str, list[int]] = {}
        self._resident_to_session: Dict[str, str] = {}

        self._broadcast_all: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None
        self._broadcast_resident: Optional[Callable[[str, Dict[str, Any]], Awaitable[None]]] = None

    def configure_broadcasts(
        self,
        *,
        broadcast_all: Callable[[Dict[str, Any]], Awaitable[None]],
        broadcast_resident: Callable[[str, Dict[str, Any]], Awaitable[None]],
    ) -> None:
        self._broadcast_all = broadcast_all
        self._broadcast_resident = broadcast_resident

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self) -> None:
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

    def set_resident_session(self, resident_id: str, session_id: str) -> None:
        rid = str(resident_id or '').strip()
        sid = str(session_id or '').strip()
        if not rid:
            return
        if not sid:
            self._resident_to_session.pop(rid, None)
            return
        self._resident_to_session[rid] = sid

    def clear_session(self, session_id: str) -> None:
        sid = str(session_id or '').strip()
        if not sid:
            return
        stale_keys = [rid for rid, mapped in self._resident_to_session.items() if mapped == sid]
        for rid in stale_keys:
            self._resident_to_session.pop(rid, None)

    async def evaluate_and_enqueue(self, resident_id: str, merged: Dict[str, Any]) -> None:
        if not bool(self.settings.proactive_monitor_enabled):
            return
        now_ts = int(merged.get('ts') or time.time())
        for event in self._collect_events(resident_id=resident_id, merged=merged, ts=now_ts):
            if self._should_enqueue(event):
                await self._queue.put(event)

    def _collect_events(self, *, resident_id: str, merged: Dict[str, Any], ts: int) -> list[ProactiveEvent]:
        metrics = (merged.get('metrics') or {}) if isinstance(merged, dict) else {}
        events: list[ProactiveEvent] = []

        if bool(metrics.get('fallSuspected')):
            events.append(
                ProactiveEvent(
                    resident_id=resident_id,
                    event_type='fall',
                    severity='high',
                    metrics_snapshot=dict(metrics),
                    ts=ts,
                )
            )

        reliance = metrics.get('reliance')
        try:
            reliance_value = float(reliance) if reliance is not None else None
        except (TypeError, ValueError):
            reliance_value = None
        if reliance_value is not None and reliance_value >= float(self.settings.proactive_weight_threshold_kg):
            events.append(
                ProactiveEvent(
                    resident_id=resident_id,
                    event_type='high_load',
                    severity='medium',
                    metrics_snapshot=dict(metrics),
                    ts=ts,
                )
            )

        balance = metrics.get('balance')
        try:
            balance_value = abs(float(balance)) if balance is not None else None
        except (TypeError, ValueError):
            balance_value = None
        if balance_value is not None and balance_value >= float(self.settings.proactive_balance_threshold):
            events.append(
                ProactiveEvent(
                    resident_id=resident_id,
                    event_type='imbalance',
                    severity='medium',
                    metrics_snapshot=dict(metrics),
                    ts=ts,
                )
            )
        return events

    def _should_enqueue(self, event: ProactiveEvent) -> bool:
        key = (event.resident_id, event.event_type)
        cooldown = max(1, int(self.settings.proactive_event_cooldown_seconds or 20))
        prev_ts = self._last_event_at.get(key, 0)
        if (event.ts - prev_ts) < cooldown:
            return False
        sig = self._event_signature(event)
        if sig == self._last_event_signature.get(key):
            return False
        self._last_event_at[key] = event.ts
        self._last_event_signature[key] = sig
        return True

    @staticmethod
    def _event_signature(event: ProactiveEvent) -> str:
        metrics = event.metrics_snapshot
        reliance = metrics.get('reliance')
        balance = metrics.get('balance')
        try:
            reliance_repr = f"{float(reliance):.1f}"
        except (TypeError, ValueError):
            reliance_repr = 'na'
        try:
            balance_repr = f"{float(balance):.2f}"
        except (TypeError, ValueError):
            balance_repr = 'na'
        return f"{event.event_type}:{reliance_repr}:{balance_repr}:{int(bool(metrics.get('fallSuspected')))}"

    async def _worker_loop(self) -> None:
        while self._running:
            event = await self._queue.get()
            try:
                await self._process_event(event)
            finally:
                self._queue.task_done()

    async def _process_event(self, event: ProactiveEvent) -> None:
        message = await self._router.generate_proactive_message(
            event_type=event.event_type,
            metrics_snapshot=event.metrics_snapshot,
        )
        spoken = False
        speak_error: Optional[str] = None
        session_id = self._resident_to_session.get(event.resident_id)
        require_active_avatar = bool(self.settings.proactive_require_active_avatar)
        if session_id:
            spoken, speak_error = await self._speak(session_id=session_id, resident_id=event.resident_id, text=message, interrupt=(event.event_type == 'fall'))
        elif not require_active_avatar:
            speak_error = 'no active avatar session mapped'
        else:
            speak_error = 'no active avatar session mapped'

        payload = {
            'type': 'proactive_event',
            'residentId': event.resident_id,
            'eventType': event.event_type,
            'severity': event.severity,
            'message': message,
            'spoken': spoken,
            'ts': event.ts,
            'error': speak_error,
        }
        if self._broadcast_all:
            await self._broadcast_all(payload)
        if self._broadcast_resident:
            await self._broadcast_resident(event.resident_id, payload)

    async def _speak(self, *, session_id: str, resident_id: str, text: str, interrupt: bool) -> tuple[bool, Optional[str]]:
        now = int(time.time())
        max_per_minute = max(1, int(self.settings.proactive_max_speaks_per_minute or 4))
        history = [ts for ts in self._last_speak_by_resident.get(resident_id, []) if (now - ts) < 60]
        if len(history) >= max_per_minute:
            self._last_speak_by_resident[resident_id] = history
            return False, 'rate_limited'
        tts_result = await self._tts.synthesize_pcm24(text=text)
        if not tts_result.get('ok'):
            return False, str(tts_result.get('error') or 'tts failed')
        if interrupt:
            await lite_agent_manager.send_interrupt(session_id)
        speak_result = await lite_agent_manager.speak_pcm(session_id, tts_result.get('pcm') or b'')
        if not speak_result.get('ok'):
            return False, str(speak_result.get('error') or 'avatar speak failed')
        history.append(now)
        self._last_speak_by_resident[resident_id] = history
        return True, None


proactive_monitor = ProactiveMonitorService()

