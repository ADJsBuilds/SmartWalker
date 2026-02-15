import time


def test_extreme_and_zero_values_do_not_crash(client):
    resident_id = 'edge-extreme'

    walker = {
        'residentId': resident_id,
        'fsrLeft': 0,
        'fsrRight': 0,
        'tiltDeg': 89.9,
        'steps': -10,
    }
    vision = {
        'residentId': resident_id,
        'personDetected': True,
        'stepCount': -5,
        'cadenceSpm': 250.0,
        'stepVar': 100.0,
        'confidence': 1.7,
        'inferenceMs': 0.0,
        'sourceFps': 0.0,
        'fallSuspected': True,
    }

    r1 = client.post('/api/walker', json=walker)
    r2 = client.post('/api/vision', json=vision)
    assert r1.status_code == 200
    assert r2.status_code == 200

    state = client.get(f'/api/state/{resident_id}')
    assert state.status_code == 200
    assert state.json()['metrics']['fallSuspected'] is True


def test_out_of_order_and_duplicate_timestamps(client, db_session):
    from app.db.models import MetricSample

    resident_id = 'edge-ts'
    now = int(time.time())
    payloads = [
        {'residentId': resident_id, 'ts': now + 30, 'fsrLeft': 10, 'fsrRight': 9, 'tiltDeg': 2, 'steps': 1},
        {'residentId': resident_id, 'ts': now - 30, 'fsrLeft': 11, 'fsrRight': 9, 'tiltDeg': 3, 'steps': 2},
        {'residentId': resident_id, 'ts': now - 30, 'fsrLeft': 11, 'fsrRight': 9, 'tiltDeg': 3, 'steps': 2},
    ]
    for p in payloads:
        response = client.post('/api/walker', json=p)
        assert response.status_code == 200

    # Should not crash and should persist at least one sampled row.
    rows = db_session.query(MetricSample).filter(MetricSample.resident_id == resident_id).count()
    assert rows >= 1
