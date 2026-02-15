from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError


def test_core_tables_created(db_session):
    table_names = set(db_session.bind.dialect.get_table_names(db_session.bind.connect()))
    expected = {
        'residents',
        'metric_samples',
        'exercise_metric_samples',
        'ingest_events',
        'hourly_metric_rollups',
        'daily_metric_rollups',
        'daily_reports',
        'clinician_documents',
        'document_chunks',
        'walking_sessions',
    }
    assert expected.issubset(table_names)


def test_daily_report_unique_constraint(db_session):
    from app.db.models import DailyReport, Resident

    db_session.add(Resident(id='r-unique-report', name='Resident Unique'))
    db_session.commit()

    db_session.add(DailyReport(resident_id='r-unique-report', date=date(2026, 2, 14), pdf_path='/tmp/a.pdf', summary_json='{}'))
    db_session.commit()

    db_session.add(DailyReport(resident_id='r-unique-report', date=date(2026, 2, 14), pdf_path='/tmp/b.pdf', summary_json='{}'))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_daily_rollup_unique_constraint(db_session):
    from app.db.models import DailyMetricRollup, Resident

    db_session.add(Resident(id='r-unique-rollup', name='Resident Unique'))
    db_session.commit()

    db_session.add(DailyMetricRollup(resident_id='r-unique-rollup', date=date(2026, 2, 14)))
    db_session.commit()

    db_session.add(DailyMetricRollup(resident_id='r-unique-rollup', date=date(2026, 2, 14)))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_metric_sample_json_roundtrip(db_session):
    from app.db.models import MetricSample, Resident

    db_session.add(Resident(id='r-json', name='JSON Resident'))
    db_session.commit()

    row = MetricSample(
        resident_id='r-json',
        ts=1771111111,
        walker_json='{"fsrLeft":20}',
        vision_json='{"stepCount":10}',
        merged_json='{"metrics":{"steps":10}}',
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    loaded = db_session.get(MetricSample, row.id)
    assert loaded is not None
    assert loaded.walker_json == '{"fsrLeft":20}'
    assert loaded.vision_json == '{"stepCount":10}'
