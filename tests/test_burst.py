def test_burst_ingest_does_not_crash_and_persists_samples(client, db_session):
    from app.db.models import MetricSample

    resident_id = 'burst-r1'
    for i in range(200):
        payload = {
            'residentId': resident_id,
            'fsrLeft': 20 + (i % 5),
            'fsrRight': 18 + (i % 5),
            'tiltDeg': float(i % 12),
            'steps': i,
        }
        response = client.post('/api/walker', json=payload)
        assert response.status_code == 200

    count = db_session.query(MetricSample).filter(MetricSample.resident_id == resident_id).count()
    assert count >= 1
