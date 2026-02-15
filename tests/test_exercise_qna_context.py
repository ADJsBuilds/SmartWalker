from app.db.models import ExerciseMetricSample


def test_qna_context_returns_empty_payload_when_no_rows(client):
    response = client.get(
        '/api/exercise-metrics/qna-context',
        params={'residentId': 'qna-empty', 'question': 'summarize my recent progress'},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['residentId'] == 'qna-empty'
    assert payload['intent'] == 'progress_summary'
    assert payload['rowsUsed'] == 0
    assert payload['staleDataFlag'] is True
    assert payload['recommendedFocus']


def test_qna_context_uses_latest_50_rows_and_intent(db_session, client):
    resident_id = 'qna-rows'
    base_ts = 1_700_000_000
    for i in range(60):
        db_session.add(
            ExerciseMetricSample(
                resident_id=resident_id,
                ts=base_ts + i,
                step_count=200 + i,
                cadence_spm=80 + (i * 0.2),
                tilt_deg=4.0 + ((i % 5) * 0.5),
                step_var=9.0 + ((i % 3) * 0.4),
                fall_suspected=(i % 29 == 0),
                posture_state='walking',
            )
        )
    db_session.commit()

    response = client.get(
        '/api/exercise-metrics/qna-context',
        params={'residentId': resident_id, 'question': 'tell me how im doing', 'maxSamples': 50},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['intent'] == 'status_check'
    assert payload['rowsUsed'] == 50
    assert payload['windowEndTs'] == base_ts + 59
    assert payload['windowStartTs'] == base_ts + 10
    assert payload['metrics']['stepDelta'] == 49
    assert payload['metrics']['postureTop'] == 'walking'
    assert 'latest 50/50 exercise samples' in payload['groundingText']


def test_qna_context_detects_improvement_intent(client, db_session):
    resident_id = 'qna-improve'
    base_ts = 1_710_000_000
    for i in range(6):
        db_session.add(
            ExerciseMetricSample(
                resident_id=resident_id,
                ts=base_ts + i,
                step_count=100 + i,
                cadence_spm=70,
                tilt_deg=11.0,
                fall_suspected=(i == 3),
            )
        )
    db_session.commit()

    response = client.get(
        '/api/exercise-metrics/qna-context',
        params={'residentId': resident_id, 'question': 'is there anything i can improve?'},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload['intent'] == 'improvement_advice'
    assert payload['rowsUsed'] == 6
    assert payload['metrics']['fallSuspectedCount'] == 1
    assert len(payload['recommendedFocus']) >= 1
