#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, delete, func
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / 'backend'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.models import (  # noqa: E402
    DailyMetricRollup,
    ExerciseMetricSample,
    HourlyMetricRollup,
    IngestEvent,
    MetricSample,
    Resident,
    WalkingSession,
)
from app.db.session import Base  # noqa: E402

SEED = 20260214
RESIDENT_ID = 'r1_test'
SESSIONS_COUNT = 50
SAMPLES_PER_SESSION = 12
TOTAL_SAMPLES = SESSIONS_COUNT * SAMPLES_PER_SESSION
BASE_START_TS = 1767254400
SESSION_GAP_SECONDS = 5400
SAMPLE_SPACING_SECONDS = 5
SESSION_DURATION_MIN_SECONDS = 7 * 60
SESSION_DURATION_MAX_SECONDS = 14 * 60


def _json(obj: dict) -> str:
    return json.dumps(obj, separators=(',', ':'))


def _round(v: float) -> float:
    return round(float(v), 2)


def _build_tilt_buckets(rng: random.Random) -> tuple[set[int], set[int], set[int]]:
    indices = list(range(TOTAL_SAMPLES))
    rng.shuffle(indices)
    fall_idx = set(indices[:9])        # 1.5%
    near_fall_idx = set(indices[9:27])  # 3.0%
    mild_lean_idx = set(indices[27:99])  # 12.0%
    return fall_idx, near_fall_idx, mild_lean_idx


def _posture_for_sample(tilt_deg: float, sample_index: int) -> str:
    if tilt_deg >= 50.0:
        return 'stooped'
    if tilt_deg >= 20.0:
        return 'leaning_left' if (sample_index % 2 == 0) else 'leaning_right'
    return 'upright'


def _step_increment(sample_index: int) -> int:
    # Mostly increasing with deterministic occasional plateaus.
    if sample_index % 6 == 0 or sample_index % 17 == 0:
        return 0
    return 2 if sample_index % 29 == 0 else 1


def _build_rows(rng: random.Random):
    walking_sessions: list[WalkingSession] = []
    metric_samples: list[MetricSample] = []
    exercise_rows: list[ExerciseMetricSample] = []

    fall_idx, near_fall_idx, mild_lean_idx = _build_tilt_buckets(rng)
    walker_steps = 0
    vision_steps = 0
    vision_fall_count = 0

    normal_example = None
    risk_example = None

    for session_idx in range(SESSIONS_COUNT):
        session_start_ts = BASE_START_TS + (session_idx * SESSION_GAP_SECONDS)
        session_duration = rng.randint(SESSION_DURATION_MIN_SECONDS, SESSION_DURATION_MAX_SECONDS)
        session_end_ts = session_start_ts + session_duration

        summary = {
            'sessionIndex': session_idx,
            'distance_m': _round(rng.uniform(40.0, 260.0)),
            'avgCadenceSpm': _round(rng.uniform(65.0, 120.0)),
            'maxTiltDeg': _round(rng.uniform(2.0, 28.0)),
            'fallEvents': rng.randint(0, 2),
            'notes': 'synthetic session for integration testing',
        }
        walking_sessions.append(
            WalkingSession(
                id=f'ws_{RESIDENT_ID}_{session_idx:03d}',
                resident_id=RESIDENT_ID,
                start_ts=session_start_ts,
                end_ts=session_end_ts,
                summary_json=_json(summary),
            )
        )

        for sample_idx in range(SAMPLES_PER_SESSION):
            global_idx = (session_idx * SAMPLES_PER_SESSION) + sample_idx
            ts = session_start_ts + (sample_idx * SAMPLE_SPACING_SECONDS)
            increment = _step_increment(global_idx)
            walker_steps += increment
            vision_steps += increment

            if global_idx in fall_idx:
                tilt_deg = _round(rng.uniform(60.0, 65.0))
                fall_suspected = True
            elif global_idx in near_fall_idx:
                tilt_deg = _round(rng.uniform(50.0, 59.0))
                fall_suspected = False
            elif global_idx in mild_lean_idx:
                tilt_deg = _round(rng.uniform(20.0, 35.0))
                fall_suspected = False
            else:
                tilt_deg = _round(rng.uniform(0.0, 19.5))
                fall_suspected = False

            if fall_suspected:
                vision_fall_count += 1

            fsr_left = rng.randint(250, 900)
            fsr_right = rng.randint(250, 900)
            posture_state = _posture_for_sample(tilt_deg, global_idx)
            cadence_spm = _round(rng.uniform(60.0, 130.0))
            step_var = _round(rng.uniform(1.0, 22.0))
            confidence = round(rng.uniform(0.70, 0.99), 3)

            walker = {
                'residentId': RESIDENT_ID,
                'deviceId': f'walker_dev_{(session_idx % 3) + 1}',
                'sessionIndex': session_idx,
                'sampleIndex': sample_idx,
                'ts': ts,
                'fsrLeft': fsr_left,
                'fsrRight': fsr_right,
                'tiltDeg': tilt_deg,
                'steps': walker_steps,
            }
            vision = {
                'residentId': RESIDENT_ID,
                'cameraId': f'cam_{(session_idx % 4) + 1}',
                'sessionIndex': session_idx,
                'sampleIndex': sample_idx,
                'ts': ts,
                'fallSuspected': fall_suspected,
                'fallCount': vision_fall_count,
                'postureState': posture_state,
                'stepCount': vision_steps,
                'cadenceSpm': cadence_spm,
                'stepVar': step_var,
                'confidence': confidence,
                'personDetected': True,
            }
            merged = {
                'residentId': RESIDENT_ID,
                'ts': ts,
                'walker': walker,
                'vision': vision,
                'metrics': {
                    'steps': vision.get('stepCount') if vision.get('stepCount') is not None else walker.get('steps'),
                    'tiltDeg': walker['tiltDeg'],
                    'reliance': fsr_left + fsr_right,
                    'balance': (fsr_left - fsr_right) / max(1, fsr_left + fsr_right),
                    'fallSuspected': bool(vision['fallSuspected'] or (walker['tiltDeg'] >= 60.0)),
                },
            }

            metric_samples.append(
                MetricSample(
                    resident_id=RESIDENT_ID,
                    ts=ts,
                    walker_json=_json(walker),
                    vision_json=_json(vision),
                    merged_json=_json(merged),
                )
            )
            exercise_rows.append(
                ExerciseMetricSample(
                    resident_id=RESIDENT_ID,
                    camera_id=vision['cameraId'],
                    ts=ts,
                    fall_suspected=bool(merged['metrics']['fallSuspected']),
                    fall_count=vision['fallCount'],
                    posture_state=vision['postureState'],
                    step_count=vision['stepCount'],
                    cadence_spm=vision['cadenceSpm'],
                    step_var=vision['stepVar'],
                    person_detected=vision['personDetected'],
                    confidence=vision['confidence'],
                    steps_merged=merged['metrics']['steps'],
                    tilt_deg=merged['metrics']['tiltDeg'],
                )
            )

            if normal_example is None and not merged['metrics']['fallSuspected'] and tilt_deg < 20.0:
                normal_example = merged
            if risk_example is None and (tilt_deg >= 50.0 or merged['metrics']['fallSuspected']):
                risk_example = merged

    return walking_sessions, metric_samples, exercise_rows, normal_example, risk_example


def _reset_rows(db) -> None:
    db.execute(delete(ExerciseMetricSample).where(ExerciseMetricSample.resident_id == RESIDENT_ID))
    db.execute(delete(MetricSample).where(MetricSample.resident_id == RESIDENT_ID))
    db.execute(delete(WalkingSession).where(WalkingSession.resident_id == RESIDENT_ID))
    db.execute(delete(IngestEvent).where(IngestEvent.resident_id == RESIDENT_ID))
    db.execute(delete(HourlyMetricRollup).where(HourlyMetricRollup.resident_id == RESIDENT_ID))
    db.execute(delete(DailyMetricRollup).where(DailyMetricRollup.resident_id == RESIDENT_ID))


def _print_verification(db) -> None:
    resident_count = db.query(func.count(Resident.id)).filter(Resident.id == RESIDENT_ID).scalar() or 0
    walking_sessions_count = db.query(func.count(WalkingSession.id)).filter(WalkingSession.resident_id == RESIDENT_ID).scalar() or 0
    metric_samples_count = db.query(func.count(MetricSample.id)).filter(MetricSample.resident_id == RESIDENT_ID).scalar() or 0
    exercise_metric_samples_count = (
        db.query(func.count(ExerciseMetricSample.id)).filter(ExerciseMetricSample.resident_id == RESIDENT_ID).scalar() or 0
    )
    min_ts, max_ts = db.query(func.min(MetricSample.ts), func.max(MetricSample.ts)).filter(MetricSample.resident_id == RESIDENT_ID).one()
    first_session = (
        db.query(WalkingSession)
        .filter(WalkingSession.resident_id == RESIDENT_ID)
        .order_by(WalkingSession.start_ts.asc())
        .first()
    )
    last_session = (
        db.query(WalkingSession)
        .filter(WalkingSession.resident_id == RESIDENT_ID)
        .order_by(WalkingSession.start_ts.desc())
        .first()
    )

    print('\nPost-seed verification:')
    print(f'  resident_count (r1_test): {resident_count} (expected 1)')
    print(f'  walking_sessions_count: {walking_sessions_count} (expected 50)')
    print(f'  metric_samples_count: {metric_samples_count} (expected 600)')
    print(f'  exercise_metric_samples_count: {exercise_metric_samples_count} (expected 600)')
    print(f'  min_ts: {min_ts}')
    print(f'  max_ts: {max_ts}')
    if first_session:
        print(f'  first_session start/end: {first_session.start_ts} -> {first_session.end_ts}')
    if last_session:
        print(f'  last_session start/end:  {last_session.start_ts} -> {last_session.end_ts}')


def main() -> None:
    parser = argparse.ArgumentParser(description='Deterministic synthetic data generator for integration testing.')
    parser.add_argument('--database-url', default=os.getenv('DATABASE_URL', 'sqlite:///./backend/data/app.db'))
    parser.add_argument('--reset', action='store_true', help='Delete existing rows for resident_id=r1_test before seeding.')
    args = parser.parse_args()

    connect_args = {'check_same_thread': False} if args.database_url.startswith('sqlite') else {}
    engine = create_engine(args.database_url, future=True, connect_args=connect_args)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
    Base.metadata.create_all(bind=engine)

    rng = random.Random(SEED)

    db = SessionLocal()
    try:
        if args.reset:
            _reset_rows(db)
        resident = db.get(Resident, RESIDENT_ID)
        if resident is None:
            db.add(Resident(id=RESIDENT_ID, name='Synthetic Resident r1_test'))
            db.flush()

        sessions, metric_rows, exercise_rows, normal_example, risk_example = _build_rows(rng)
        db.add_all(sessions)
        db.add_all(metric_rows)
        db.add_all(exercise_rows)
        db.commit()

        print(f'Seed complete: seed={SEED}, resident_id={RESIDENT_ID}')
        print(f'  sessions={len(sessions)}, metric_samples={len(metric_rows)}, exercise_metric_samples={len(exercise_rows)}')

        if normal_example is not None:
            print('\nExample normal gait sample:')
            print(json.dumps(normal_example, indent=2))
        if risk_example is not None:
            print('\nExample near-fall/fall-suspected sample:')
            print(json.dumps(risk_example, indent=2))

        _print_verification(db)
    finally:
        db.close()


if __name__ == '__main__':
    main()
