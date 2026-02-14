import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.db.models import MetricSample, Resident
from app.core.config import get_settings
from app.db.session import get_db
from app.services.merge_state import compute_merged, merged_state, now_ts, vision_state, walker_state
from app.services.analytics_store import persist_analytics_tick
from app.routers.ws import manager

router = APIRouter(tags=['ingest'])

_LAST_PERSIST: Dict[str, int] = {}
_LAST_ANALYTICS_PERSIST: Dict[str, int] = {}
_SAMPLE_COUNTER: Dict[str, int] = {}


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
    fallCount: Optional[int] = Field(default=None, validation_alias=AliasChoices('fallCount', 'fall_count'))
    totalTimeOnGroundSeconds: Optional[float] = Field(
        default=None, validation_alias=AliasChoices('totalTimeOnGroundSeconds', 'total_time_on_ground_seconds')
    )
    postureState: Optional[str] = Field(default=None, validation_alias=AliasChoices('postureState', 'posture_state'))
    stepCount: Optional[int] = Field(default=None, validation_alias=AliasChoices('stepCount', 'step_count'))
    cadenceSpm: Optional[float] = Field(default=None, validation_alias=AliasChoices('cadenceSpm', 'cadence_spm'))
    avgCadenceSpm: Optional[float] = Field(default=None, validation_alias=AliasChoices('avgCadenceSpm', 'avg_cadence_spm'))
    stepTimeCv: Optional[float] = Field(default=None, validation_alias=AliasChoices('stepTimeCv', 'step_time_cv'))
    stepTimeMean: Optional[float] = Field(default=None, validation_alias=AliasChoices('stepTimeMean', 'step_time_mean'))
    activityState: Optional[str] = Field(default=None, validation_alias=AliasChoices('activityState', 'activity_state'))
    asymmetryIndex: Optional[float] = Field(default=None, validation_alias=AliasChoices('asymmetryIndex', 'asymmetry_index'))
    fallRiskLevel: Optional[str] = Field(default=None, validation_alias=AliasChoices('fallRiskLevel', 'fall_risk_level'))
    fallRiskScore: Optional[float] = Field(default=None, validation_alias=AliasChoices('fallRiskScore', 'fall_risk_score'))
    fogStatus: Optional[str] = Field(default=None, validation_alias=AliasChoices('fogStatus', 'fog_status'))
    fogEpisodes: Optional[int] = Field(default=None, validation_alias=AliasChoices('fogEpisodes', 'fog_episodes'))
    fogDurationSeconds: Optional[float] = Field(default=None, validation_alias=AliasChoices('fogDurationSeconds', 'fog_duration_seconds'))
    stepVar: Optional[float] = Field(default=None, validation_alias=AliasChoices('stepVar', 'step_var'))
    personDetected: Optional[bool] = Field(default=None, validation_alias=AliasChoices('personDetected', 'person_detected'))
    confidence: Optional[float] = None
    sourceFps: Optional[float] = Field(default=None, validation_alias=AliasChoices('sourceFps', 'source_fps'))
    inferenceMs: Optional[float] = Field(default=None, validation_alias=AliasChoices('inferenceMs', 'inference_ms'))
    frameId: Optional[str] = Field(default=None, validation_alias=AliasChoices('frameId', 'frame_id'))


async def _update_and_push(resident_id: str, db: Session) -> None:
    settings = get_settings()
    persist_interval_seconds = max(1, int(settings.ingest_persist_interval_seconds or 5))
    full_payload_every = max(1, int(settings.ingest_store_full_payload_every_n_samples or 3))
    analytics_interval_seconds = max(1, persist_interval_seconds // 2)

    merged = compute_merged(resident_id)
    merged_state[resident_id] = merged
    event = {'type': 'merged_update', 'data': merged}
    await manager.broadcast_all(event)
    await manager.broadcast_resident(resident_id, event)

    if not db.get(Resident, resident_id):
        db.add(Resident(id=resident_id, name=None))
        # Ensure FK target exists before inserting rollups/events in this transaction.
        db.flush()

    now = int(time.time())
    metrics = merged.get('metrics') or {}
    tilt_deg = metrics.get('tiltDeg')
    critical = bool(metrics.get('fallSuspected')) or (isinstance(tilt_deg, (int, float)) and float(tilt_deg) >= 50)

    if critical or now - _LAST_ANALYTICS_PERSIST.get(resident_id, 0) >= analytics_interval_seconds:
        _LAST_ANALYTICS_PERSIST[resident_id] = now
        persist_analytics_tick(
            db,
            resident_id,
            merged,
            persist_interval_seconds=analytics_interval_seconds,
        )
    if now - _LAST_PERSIST.get(resident_id, 0) < persist_interval_seconds:
        db.commit()
        return

    _LAST_PERSIST[resident_id] = now
    _SAMPLE_COUNTER[resident_id] = _SAMPLE_COUNTER.get(resident_id, 0) + 1
    keep_full_payload = (_SAMPLE_COUNTER[resident_id] % full_payload_every) == 0

    walker_payload = walker_state.get(resident_id) or {}
    vision_payload = vision_state.get(resident_id) or {}
    merged_payload = merged if keep_full_payload else {'residentId': resident_id, 'ts': merged.get('ts'), 'metrics': metrics}

    db.add(
        MetricSample(
            resident_id=resident_id,
            ts=int(merged.get('ts') or now),
            walker_json=json.dumps(walker_payload if keep_full_payload else {}),
            vision_json=json.dumps(vision_payload if keep_full_payload else {}),
            merged_json=json.dumps(merged_payload),
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
