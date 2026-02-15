import time


def test_persistence_sampling_and_payload_mode(client, db_session):
    from app.db.models import ExerciseMetricSample, MetricSample

    resident_id = 'persist-sampled'
    base = {'residentId': resident_id, 'fsrLeft': 20, 'fsrRight': 18, 'tiltDeg': 4}

    # First packet should persist.
    response1 = client.post('/api/walker', json={**base, 'steps': 1})
    assert response1.status_code == 200

    # Immediate second packet should be throttled for metric sample insert.
    response2 = client.post('/api/walker', json={**base, 'steps': 2})
    assert response2.status_code == 200

    rows = db_session.query(MetricSample).filter(MetricSample.resident_id == resident_id).all()
    assert len(rows) == 1

    # Wait to pass persistence interval, third packet should persist.
    time.sleep(1.1)
    response3 = client.post('/api/walker', json={**base, 'steps': 3})
    assert response3.status_code == 200

    rows = (
        db_session.query(MetricSample)
        .filter(MetricSample.resident_id == resident_id)
        .order_by(MetricSample.ts.asc())
        .all()
    )
    assert len(rows) >= 2

    # With N=2: first sampled row compact, second sampled row full payload.
    first_walker_json = rows[0].walker_json
    second_walker_json = rows[1].walker_json
    assert first_walker_json in ('{}', '{}')
    assert second_walker_json != '{}'

    normalized_rows = db_session.query(ExerciseMetricSample).filter(ExerciseMetricSample.resident_id == resident_id).all()
    assert len(normalized_rows) >= 2
