from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from competitor_intel.api.routes.ask import router as ask_router
from competitor_intel.api.routes.auth import router as auth_router
from competitor_intel.api.routes.competitors import router as competitors_router
from competitor_intel.api.routes.crawl_jobs import router as crawl_jobs_router
from competitor_intel.api.routes.discovery import router as discovery_router
from competitor_intel.api.routes.events import router as events_router
from competitor_intel.api.routes.health import router as health_router
from competitor_intel.api.routes.overview import router as overview_router
from competitor_intel.api.routes.reports import router as reports_router
from competitor_intel.api.routes.snapshots import router as snapshots_router
from competitor_intel.api.routes.sources import router as sources_router
from competitor_intel.api.routes.system import router as system_router
from competitor_intel.bootstrap import bootstrap
from competitor_intel.config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    bootstrap()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=settings.app_secret_key)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3410"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(overview_router)
app.include_router(system_router)
app.include_router(competitors_router)
app.include_router(crawl_jobs_router)
app.include_router(sources_router)
app.include_router(snapshots_router)
app.include_router(events_router)
app.include_router(reports_router)
app.include_router(discovery_router)
app.include_router(ask_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "mode": settings.app_env}
