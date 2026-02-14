import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.models import MetricSample, Resident
from app.db.session import get_db
from app.services.merge_state import compute_merged, merged_state, now_ts, vision_state, walker_state
from app.routers.ws import manager

router = APIRouter(tags=['ingest'])

_LAST_PERSIST: Dict[str, int] = {}
_PERSIST_INTERVAL_SECONDS = 5


class WalkerPacket(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='ignore')

    residentId: str = Field(validation_alias=AliasChoices('residentId', 'resident_id'))
    deviceId: Optional[str] = Field(default=None, validation_alias=AliasChoices('deviceId', 'device_id'))
    ts: Optional[int] = None
    fsrLeft: int = Field(validation_alias=AliasChoices('fsrLeft', 'fsr_left'))
    fsrRight: int = Field(validation_alias=AliasChoices('fsrRight', 'fsr_right'))
    tiltDeg: Optional[float] = Field(default=None, validation_alias=AliasChoices('tiltDeg', 'tilt_deg'))
    steps: Optional[int] = None


class VisionPacket(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra='ignore')

    residentId: str = Field(validation_alias=AliasChoices('residentId', 'resident_id'))
    cameraId: Optional[str] = Field(default=None, validation_alias=AliasChoices('cameraId', 'camera_id'))
    ts: Optional[int] = None
    fallSuspected: bool = Field(default=False, validation_alias=AliasChoices('fallSuspected', 'fall_suspected'))
    cadenceSpm: Optional[float] = Field(default=None, validation_alias=AliasChoices('cadenceSpm', 'cadence_spm'))
    stepVar: Optional[float] = Field(default=None, validation_alias=AliasChoices('stepVar', 'step_var'))


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
