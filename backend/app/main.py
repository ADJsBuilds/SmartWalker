from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.init_db import init_db
from app.routers import agent, carrier, documents, health, ingest, integrations, liveavatar, patients, reports, ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(get_settings().log_level)
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title='SmartWalker Backend', lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )

    app.include_router(health.router)
    app.include_router(ingest.router)
    app.include_router(ws.router)
    app.include_router(patients.router)
    app.include_router(documents.router)
    app.include_router(reports.router)
    app.include_router(agent.router)
    app.include_router(integrations.router)
    app.include_router(carrier.router)
    app.include_router(liveavatar.router)

    return app


app = create_app()
