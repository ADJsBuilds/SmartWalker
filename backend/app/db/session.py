from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import get_settings

settings = get_settings()


def _normalize_sqlite_url(url: str) -> str:
    if not url.startswith('sqlite:///'):
        return url
    rel_path = url.replace('sqlite:///', '', 1)
    Path(rel_path).parent.mkdir(parents=True, exist_ok=True)
    return url


DATABASE_URL = _normalize_sqlite_url(settings.database_url)
connect_args = {'check_same_thread': False} if DATABASE_URL.startswith('sqlite') else {}
engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
