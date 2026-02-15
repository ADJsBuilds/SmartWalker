def test_state_after_walker_ingest(client):
    resident_id = 'state-walker'
    client.post('/api/walker', json={'residentId': resident_id, 'fsrLeft': 20, 'fsrRight': 10, 'steps': 50, 'tiltDeg': 7})

    response = client.get(f'/api/state/{resident_id}')
    assert response.status_code == 200
    data = response.json()
    assert data['residentId'] == resident_id
    assert isinstance(data['walker'], dict)
    assert data['vision'] is None
    assert data['metrics']['steps'] == 50
    assert data['metrics']['tiltDeg'] == 7


def test_steps_priority_vision_over_walker(client):
    resident_id = 'state-steps-priority'
    client.post('/api/walker', json={'residentId': resident_id, 'fsrLeft': 12, 'fsrRight': 11, 'steps': 100, 'tiltDeg': 5})
    client.post('/api/vision', json={'residentId': resident_id, 'stepCount': 155})

    response = client.get(f'/api/state/{resident_id}')
    data = response.json()
    assert data['metrics']['steps'] == 155


def test_balance_and_reliance_computation(client):
    resident_id = 'state-balance'
    client.post('/api/walker', json={'residentId': resident_id, 'fsrLeft': 0, 'fsrRight': 0, 'tiltDeg': 2})
    data = client.get(f'/api/state/{resident_id}').json()

    assert data['metrics']['reliance'] > 0
    assert abs(data['metrics']['balance']) < 1e-6


def test_fall_suspected_logic_from_vision_or_tilt(client):
    resident_vision = 'state-fall-vision'
    client.post('/api/walker', json={'residentId': resident_vision, 'fsrLeft': 10, 'fsrRight': 11, 'tiltDeg': 5})
    client.post('/api/vision', json={'residentId': resident_vision, 'fallSuspected': True})
    data_vision = client.get(f'/api/state/{resident_vision}').json()
    assert data_vision['metrics']['fallSuspected'] is True

    resident_tilt = 'state-fall-tilt'
    client.post('/api/walker', json={'residentId': resident_tilt, 'fsrLeft': 10, 'fsrRight': 11, 'tiltDeg': 61})
    data_tilt = client.get(f'/api/state/{resident_tilt}').json()
    assert data_tilt['metrics']['fallSuspected'] is True
