def test_walker_accepts_valid_minimal_payload(client):
    payload = {
        'residentId': 'walker-valid',
        'fsrLeft': 20,
        'fsrRight': 18,
    }
    response = client.post('/api/walker', json=payload)
    assert response.status_code == 200
    assert response.json() == {'ok': True}


def test_walker_rejects_missing_required_fields(client):
    response = client.post('/api/walker', json={'residentId': 'walker-invalid'})
    assert response.status_code == 422


def test_walker_rejects_wrong_types(client):
    payload = {
        'residentId': 'walker-types',
        'fsrLeft': 'bad',
        'fsrRight': 18,
    }
    response = client.post('/api/walker', json=payload)
    assert response.status_code == 422


def test_walker_accepts_optional_fields_and_ignores_extra(client):
    payload = {
        'residentId': 'walker-optional',
        'deviceId': 'dev-1',
        'ts': 1771111111,
        'fsrLeft': 24,
        'fsrRight': 21,
        'tiltDeg': 8.5,
        'steps': -3,
        'unexpected': 'ignored',
    }
    response = client.post('/api/walker', json=payload)
    assert response.status_code == 200
    assert response.json() == {'ok': True}


def test_vision_accepts_minimal_payload(client):
    response = client.post('/api/vision', json={'residentId': 'vision-min'})
    assert response.status_code == 200
    assert response.json() == {'ok': True}


def test_vision_rejects_wrong_types(client):
    payload = {
        'residentId': 'vision-invalid',
        'fallSuspected': 'yes',
        'stepCount': 'abc',
    }
    response = client.post('/api/vision', json=payload)
    assert response.status_code == 422


def test_vision_accepts_optional_fields_and_ignores_extra(client):
    payload = {
        'residentId': 'vision-opt',
        'cameraId': 'cam-a',
        'fallSuspected': False,
        'stepCount': 123,
        'cadenceSpm': 90.4,
        'stepVar': 9.8,
        'personDetected': True,
        'confidence': 0.91,
        'inferenceMs': 24.2,
        'sourceFps': 29.7,
        'extraField': 'ignored',
    }
    response = client.post('/api/vision', json=payload)
    assert response.status_code == 200
    assert response.json() == {'ok': True}
