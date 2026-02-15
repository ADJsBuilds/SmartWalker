import sys
import importlib
from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / 'backend'
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def app_with_db(tmp_path: Path, monkeypatch) -> Generator[tuple, None, None]:
    db_path = tmp_path / 'test.db'
    storage_path = tmp_path / 'storage'
    storage_path.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv('DATABASE_URL', f'sqlite:///{db_path}')
    monkeypatch.setenv('STORAGE_DIR', str(storage_path))
    monkeypatch.setenv('INGEST_PERSIST_INTERVAL_SECONDS', '1')
    monkeypatch.setenv('INGEST_STORE_FULL_PAYLOAD_EVERY_N_SAMPLES', '2')
    monkeypatch.setenv('GEMINI_ENABLED', 'false')

    from app.core.config import get_settings

    get_settings.cache_clear()

    import app.db.session as db_session_mod
    import app.main as app_main_mod
    import app.db.models as db_models_mod
    import app.routers.ingest as ingest_router_mod
    import app.routers.ws as ws_router_mod
    import app.routers.health as health_router_mod
    import app.routers.patients as patients_router_mod
    import app.routers.documents as documents_router_mod
    import app.routers.reports as reports_router_mod
    import app.routers.suggestions as suggestions_router_mod
    import app.routers.agent as agent_router_mod
    import app.routers.integrations as integrations_router_mod
    import app.routers.carrier as carrier_router_mod
    import app.routers.liveavatar as liveavatar_router_mod
    import app.routers.eleven as eleven_router_mod
    from app.services import analytics_store, merge_state

    db_session_mod = importlib.reload(db_session_mod)
    db_models_mod = importlib.reload(db_models_mod)
    ingest_router_mod = importlib.reload(ingest_router_mod)
    ws_router_mod = importlib.reload(ws_router_mod)
    health_router_mod = importlib.reload(health_router_mod)
    patients_router_mod = importlib.reload(patients_router_mod)
    documents_router_mod = importlib.reload(documents_router_mod)
    reports_router_mod = importlib.reload(reports_router_mod)
    suggestions_router_mod = importlib.reload(suggestions_router_mod)
    agent_router_mod = importlib.reload(agent_router_mod)
    integrations_router_mod = importlib.reload(integrations_router_mod)
    carrier_router_mod = importlib.reload(carrier_router_mod)
    liveavatar_router_mod = importlib.reload(liveavatar_router_mod)
    eleven_router_mod = importlib.reload(eleven_router_mod)
    app_main_mod = importlib.reload(app_main_mod)

    Base = db_session_mod.Base
    get_db = db_session_mod.get_db
    ingest = ingest_router_mod

    test_engine = create_engine(
        f'sqlite:///{db_path}',
        future=True,
        connect_args={'check_same_thread': False},
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, future=True)
    # Ensure all ORM models are registered on Base before create_all.
    _ = db_models_mod
    Base.metadata.create_all(bind=test_engine)

    # Avoid creating production DB/filesystem resources in tests.
    monkeypatch.setattr(app_main_mod, 'init_db', lambda: None)
    app = app_main_mod.create_app()

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # Reset in-memory runtime state per test.
    merge_state.walker_state.clear()
    merge_state.vision_state.clear()
    merge_state.merged_state.clear()
    ingest._LAST_PERSIST.clear()
    ingest._LAST_ANALYTICS_PERSIST.clear()
    ingest._SAMPLE_COUNTER.clear()
    analytics_store._last_event_ts.clear()
    analytics_store._last_steps.clear()
    analytics_store._last_step_change_ts.clear()

    try:
        yield app, TestingSessionLocal, tmp_path
    finally:
        app.dependency_overrides.clear()
        test_engine.dispose()


@pytest.fixture()
def client(app_with_db) -> Generator[TestClient, None, None]:
    app, _, _ = app_with_db
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def db_session(app_with_db):
    _, session_factory, _ = app_with_db
    db = session_factory()
    try:
        yield db
    finally:
        db.close()
