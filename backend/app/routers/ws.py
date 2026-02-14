from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.services.merge_state import merged_state
from app.services.ws_manager import ConnectionManager

router = APIRouter(tags=['ws'])
manager = ConnectionManager()


async def _ws_loop(websocket: WebSocket, resident_id: Optional[str] = None) -> None:
    await manager.connect(websocket, resident_id=resident_id)
    try:
        if resident_id:
            data = [merged_state[resident_id]] if resident_id in merged_state else []
        else:
            data = list(merged_state.values())
        await websocket.send_json({'type': 'snapshot', 'data': data})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)


@router.websocket('/ws')
async def ws_legacy(websocket: WebSocket):
    await _ws_loop(websocket, resident_id=None)


@router.websocket('/ws/live')
async def ws_live(websocket: WebSocket, residentId: Optional[str] = Query(default=None)):
    await _ws_loop(websocket, resident_id=residentId)
