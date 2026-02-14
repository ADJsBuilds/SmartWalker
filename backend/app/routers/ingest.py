import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.models import MetricSample, Resident
from app.db.session import get_db
from app.services.merge_state import compute_merged, merged_state, now_ts, vision_state, walker_state
from app.routers.ws import manager

router = APIRouter(tags=['ingest'])

_LAST_PERSIST: Dict[str, int] = {}
_PERSIST_INTERVAL_SECONDS = 5


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


async def _update_and_push(resident_id: str, db: Session) -> None:
    merged = compute_merged(resident_id)
    merged_state[resident_id] = merged
    event = {'type': 'merged_update', 'data': merged}
    await manager.broadcast_all(event)
    await manager.broadcast_resident(resident_id, event)

    now = int(time.time())
    if now - _LAST_PERSIST.get(resident_id, 0) < _PERSIST_INTERVAL_SECONDS:
        return
    _LAST_PERSIST[resident_id] = now

    if not db.get(Resident, resident_id):
        db.add(Resident(id=resident_id, name=None))

    db.add(
        MetricSample(
            resident_id=resident_id,
            ts=merged['ts'],
            walker_json=json.dumps(walker_state.get(resident_id) or {}),
            vision_json=json.dumps(vision_state.get(resident_id) or {}),
            merged_json=json.dumps(merged),
        )
    )
    db.commit()


@router.post('/api/walker')
async def post_walker(pkt: WalkerPacket, db: Session = Depends(get_db)):
    d = pkt.model_dump()
    d['ts'] = d['ts'] or now_ts()
    walker_state[pkt.residentId] = d
    await _update_and_push(pkt.residentId, db)
    return {'ok': True}


@router.post('/api/vision')
async def post_vision(pkt: VisionPacket, db: Session = Depends(get_db)):
    d = pkt.model_dump()
    d['ts'] = d['ts'] or now_ts()
    vision_state[pkt.residentId] = d
    await _update_and_push(pkt.residentId, db)
    return {'ok': True}


@router.get('/api/state/{resident_id}')
def get_state(resident_id: str):
    return merged_state.get(resident_id) or {'error': 'no state yet'}
