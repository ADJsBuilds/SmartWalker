from collections import defaultdict
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.all_connections: Set[WebSocket] = set()
        self.resident_subscribers: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.connection_to_resident: Dict[WebSocket, Optional[str]] = {}

    async def connect(self, websocket: WebSocket, resident_id: Optional[str] = None) -> None:
        await websocket.accept()
        self.all_connections.add(websocket)
        self.connection_to_resident[websocket] = resident_id
        if resident_id:
            self.resident_subscribers[resident_id].add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        resident_id = self.connection_to_resident.pop(websocket, None)
        self.all_connections.discard(websocket)
        if resident_id and resident_id in self.resident_subscribers:
            self.resident_subscribers[resident_id].discard(websocket)
            if not self.resident_subscribers[resident_id]:
                self.resident_subscribers.pop(resident_id, None)

    async def _safe_send(self, websocket: WebSocket, payload: Dict[str, Any]) -> bool:
        try:
            await websocket.send_json(payload)
            return True
        except Exception:
            self.disconnect(websocket)
            return False

    async def broadcast_all(self, payload: Dict[str, Any]) -> None:
        for ws in list(self.all_connections):
            await self._safe_send(ws, payload)

    async def broadcast_resident(self, resident_id: str, payload: Dict[str, Any]) -> None:
        for ws in list(self.resident_subscribers.get(resident_id, set())):
            await self._safe_send(ws, payload)
