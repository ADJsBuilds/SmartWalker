from datetime import datetime
from pathlib import Path


def test_rollups_and_events_created_for_critical_packets(client, db_session):
    from app.db.models import DailyMetricRollup, HourlyMetricRollup, IngestEvent

    resident_id = 'rollup-critical'

    # Critical condition via high tilt should trigger analytics path and eventing.
    response = client.post(
        '/api/walker',
        json={'residentId': resident_id, 'fsrLeft': 30, 'fsrRight': 28, 'tiltDeg': 65, 'steps': 20},
    )
    assert response.status_code == 200

    daily = db_session.query(DailyMetricRollup).filter(DailyMetricRollup.resident_id == resident_id).all()
    hourly = db_session.query(HourlyMetricRollup).filter(HourlyMetricRollup.resident_id == resident_id).all()
    events = db_session.query(IngestEvent).filter(IngestEvent.resident_id == resident_id).all()

    assert len(daily) >= 1
    assert len(hourly) >= 1
    assert any(e.event_type in {'fall', 'near-fall', 'heavy-lean'} for e in events)


def test_stats_endpoint_returns_rollup_data(client):
    resident_id = 'stats-endpoint'
    # Use a critical tilt value to deterministically force analytics tick + rollup update.
    client.post('/api/walker', json={'residentId': resident_id, 'fsrLeft': 24, 'fsrRight': 22, 'tiltDeg': 65, 'steps': 11})
    response = client.get(f'/api/reports/stats?residentId={resident_id}&days=1')
    assert response.status_code == 200
    payload = response.json()
    assert payload['residentId'] == resident_id
    assert 'daily' in payload and 'hourly' in payload and 'events' in payload
    assert len(payload['hourly']) >= 1


def test_report_generate_placeholder_creates_non_empty_pdf(client, db_session):
    from app.db.models import DailyReport

    resident_id = 'report-placeholder'
    date_str = datetime.utcnow().date().isoformat()

    response = client.post(f'/api/reports/daily/generate?residentId={resident_id}&date={date_str}&usePlaceholder=true')
    assert response.status_code == 200
    data = response.json()
    assert data['usedPlaceholderData'] is True
    report_id = data['reportId']

    row = db_session.get(DailyReport, report_id)
    assert row is not None
    assert Path(row.pdf_path).exists()
    assert Path(row.pdf_path).stat().st_size > 0

    download = client.get(f'/api/reports/daily/{report_id}/download')
    assert download.status_code == 200
    assert download.headers['content-type'].startswith('application/pdf')


def test_report_generate_from_seeded_data_creates_pdf(client, db_session):
    from app.db.models import DailyReport, MetricSample, Resident

    resident_id = 'report-seeded'
    today = datetime.utcnow().date()
    ts = int(datetime(today.year, today.month, today.day, 12, 0, 0).timestamp())
    db_session.add(Resident(id=resident_id, name='Report Seeded'))
    db_session.add(
        MetricSample(
            resident_id=resident_id,
            ts=ts,
            walker_json='{"residentId":"report-seeded","fsrLeft":22,"fsrRight":21}',
            vision_json='{"residentId":"report-seeded","cadenceSpm":92.1,"stepVar":10.0}',
            merged_json='{"residentId":"report-seeded","ts":%d,"metrics":{"steps":145,"tiltDeg":4,"fallSuspected":false},"walker":{"fsrLeft":22,"fsrRight":21},"vision":{"cadenceSpm":92.1,"stepVar":10.0}}'
            % ts,
        )
    )
    db_session.commit()

    date_str = today.isoformat()
    response = client.post(f'/api/reports/daily/generate?residentId={resident_id}&date={date_str}')
    assert response.status_code == 200
    report_id = response.json()['reportId']
    row = db_session.get(DailyReport, report_id)
    assert row is not None
    assert Path(row.pdf_path).exists()
    assert Path(row.pdf_path).stat().st_size > 0
