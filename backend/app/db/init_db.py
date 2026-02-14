from pathlib import Path

from app.core.config import get_settings
from app.db.session import Base, engine


def init_db() -> None:
    settings = get_settings()
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
