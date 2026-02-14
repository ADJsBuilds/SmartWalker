from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Dict, Any, Optional, Set
import time

app = FastAPI()

class WalkerPacket(BaseModel):
    residentId: str
    deviceId: Optional[str] = None
    ts: Optional[int] = None
    fsrLeft: int
    fsrRight: int
    tiltDeg: Optional[float] = None
    steps: Optional[int] = None

class VisionPacket(BaseModel):
    residentId: str
    cameraId: Optional[str] = None
    ts: Optional[int] = None
    fallSuspected: bool = False
    cadenceSpm: Optional[float] = None
    stepVar: Optional[float] = None

walker_state: Dict[str, Dict[str, Any]] = {}
vision_state: Dict[str, Dict[str, Any]] = {}
merged_state: Dict[str, Dict[str, Any]] = {}
active_sockets: Set[WebSocket] = set()

def now_ts() -> int:
    return int(time.time())

def compute_merged(resident_id: str) -> Dict[str, Any]:
    w = walker_state.get(resident_id)
    v = vision_state.get(resident_id)

    fsr_left = (w or {}).get("fsrLeft", 0)
    fsr_right = (w or {}).get("fsrRight", 0)
    total = fsr_left + fsr_right + 1e-6
    balance = (fsr_left - fsr_right) / total

    tilt = (w or {}).get("tiltDeg")
    steps = (w or {}).get("steps")

    fall_from_vision = bool((v or {}).get("fallSuspected", False))
    walker_tipped = (tilt is not None) and (tilt >= 60)

    return {
        "residentId": resident_id,
        "ts": max((w or {}).get("ts", 0), (v or {}).get("ts", 0), now_ts()),
        "walker": w,
        "vision": v,
        "metrics": {
            "steps": steps,
            "tiltDeg": tilt,
            "reliance": total,
            "balance": balance,
            "fallSuspected": fall_from_vision or walker_tipped,
        },
    }

async def broadcast(event: Dict[str, Any]) -> None:
    dead = []
    for ws in list(active_sockets):
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_sockets.discard(ws)

async def update_and_push(resident_id: str) -> None:
    merged = compute_merged(resident_id)
    merged_state[resident_id] = merged
    await broadcast({"type": "merged_update", "data": merged})

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/walker")
async def post_walker(pkt: WalkerPacket):
    d = pkt.model_dump()
    d["ts"] = d["ts"] or now_ts()
    walker_state[pkt.residentId] = d
    await update_and_push(pkt.residentId)
    return {"ok": True}

@app.post("/api/vision")
async def post_vision(pkt: VisionPacket):
    d = pkt.model_dump()
    d["ts"] = d["ts"] or now_ts()
    vision_state[pkt.residentId] = d
    await update_and_push(pkt.residentId)
    return {"ok": True}

@app.get("/api/state/{resident_id}")
def get_state(resident_id: str):
    return merged_state.get(resident_id) or {"error": "no state yet"}

@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    active_sockets.add(websocket)
    try:
        await websocket.send_json({"type": "snapshot", "data": list(merged_state.values())})
        while True:
            # client can send pings, but not required for your demo if frontend keeps it open
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        active_sockets.discard(websocket)
