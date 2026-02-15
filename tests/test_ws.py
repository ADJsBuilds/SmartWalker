def test_ws_snapshot_global_and_updates(client):
    resident_id = 'ws-global'
    with client.websocket_connect('/ws') as websocket:
        snapshot = websocket.receive_json()
        assert snapshot['type'] == 'snapshot'
        assert isinstance(snapshot['data'], list)

        post_response = client.post('/api/walker', json={'residentId': resident_id, 'fsrLeft': 22, 'fsrRight': 18, 'steps': 10, 'tiltDeg': 3})
        assert post_response.status_code == 200

        update = websocket.receive_json()
        assert update['type'] == 'merged_update'
        assert update['data']['residentId'] == resident_id


def test_ws_snapshot_scoped_and_filtering(client):
    target = 'ws-r1'
    other = 'ws-r2'

    client.post('/api/walker', json={'residentId': target, 'fsrLeft': 20, 'fsrRight': 19, 'steps': 9, 'tiltDeg': 2})

    with client.websocket_connect(f'/ws/live?residentId={target}') as websocket:
        snapshot = websocket.receive_json()
        assert snapshot['type'] == 'snapshot'
        assert isinstance(snapshot['data'], list)
        assert len(snapshot['data']) == 1
        assert snapshot['data'][0]['residentId'] == target

        client.post('/api/walker', json={'residentId': other, 'fsrLeft': 30, 'fsrRight': 28, 'steps': 12, 'tiltDeg': 4})
        client.post('/api/walker', json={'residentId': target, 'fsrLeft': 25, 'fsrRight': 24, 'steps': 15, 'tiltDeg': 4})

        # Should receive target update, not block on unrelated resident.
        update = websocket.receive_json()
        assert update['type'] == 'merged_update'
        assert update['data']['residentId'] == target
