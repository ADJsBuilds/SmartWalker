#!/usr/bin/env python3
import argparse
import json
import math
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / 'backend'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db.models import MetricSample, Resident  # noqa: E402
from app.db.session import Base  # noqa: E402


def build_rows(resident_id: str, day: datetime, samples: int):
    start = datetime(day.year, day.month, day.day, 8, 0, 0, tzinfo=timezone.utc)
    step = max(1, int((10 * 3600) / samples))
    rows = []
    step_count = 0

    for i in range(samples):
        ts = int((start + timedelta(seconds=i * step)).timestamp())
        fsr_left = 18 + int(8 * math.sin(i / 11.0)) + random.randint(-2, 2)
        fsr_right = 18 + int(7 * math.cos(i / 13.0)) + random.randint(-2, 2)
        tilt = 4.0 + 2.2 * math.sin(i / 9.0)
        if i % 97 == 0:
            tilt = 58.0
        if i % 151 == 0:
            tilt = 63.0

        step_count += random.randint(0, 3)
        cadence = 86.0 + 7.0 * math.sin(i / 17.0)
        step_var = 8.5 + 2.5 * abs(math.sin(i / 19.0))
        person_detected = (i % 31) != 0
        confidence = 0.72 + 0.25 * abs(math.sin(i / 21.0))
        fall_suspected = tilt >= 60.0

        walker = {
            'residentId': resident_id,
            'ts': ts,
            'fsrLeft': max(0, fsr_left),
            'fsrRight': max(0, fsr_right),
            'tiltDeg': round(tilt, 2),
            'steps': step_count,
        }
        vision = {
            'residentId': resident_id,
            'ts': ts,
            'personDetected': bool(person_detected),
            'stepCount': step_count,
            'cadenceSpm': round(cadence, 2),
            'stepVar': round(step_var, 2),
            'confidence': round(min(0.99, max(0.0, confidence)), 3),
            'inferenceMs': random.randint(18, 45),
            'sourceFps': round(24.0 + 6.0 * abs(math.sin(i / 8.0)), 2),
            'fallSuspected': bool(fall_suspected),
        }
        merged = {
            'residentId': resident_id,
            'ts': ts,
            'walker': walker,
            'vision': vision,
            'metrics': {
                'steps': step_count,
                'tiltDeg': round(tilt, 2),
                'reliance': walker['fsrLeft'] + walker['fsrRight'] + 1e-6,
                'balance': (walker['fsrLeft'] - walker['fsrRight']) / max(walker['fsrLeft'] + walker['fsrRight'], 1),
                'fallSuspected': bool(fall_suspected),
            },
        }
        rows.append(
            MetricSample(
                resident_id=resident_id,
                ts=ts,
                walker_json=json.dumps(walker),
                vision_json=json.dumps(vision),
                merged_json=json.dumps(merged),
            )
        )
    return rows


def main():
    parser = argparse.ArgumentParser(description='Seed one day of dummy MetricSample data.')
    parser.add_argument('--resident-id', default='dummy-r1')
    parser.add_argument('--date', default=datetime.utcnow().date().isoformat(), help='YYYY-MM-DD (UTC day)')
    parser.add_argument('--samples', type=int, default=480, help='Number of samples to insert')
    parser.add_argument('--database-url', default=os.getenv('DATABASE_URL', 'sqlite:///./backend/data/app.db'))
    args = parser.parse_args()

    day = datetime.strptime(args.date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    engine = create_engine(args.database_url, future=True, connect_args={'check_same_thread': False} if args.database_url.startswith('sqlite') else {})
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if not db.get(Resident, args.resident_id):
            db.add(Resident(id=args.resident_id, name=f'Dummy {args.resident_id}'))
            db.flush()
        rows = build_rows(args.resident_id, day, args.samples)
        db.add_all(rows)
        db.commit()
        print(f'Inserted {len(rows)} metric_samples for resident={args.resident_id} date={args.date}')
    finally:
        db.close()


if __name__ == '__main__':
    main()
