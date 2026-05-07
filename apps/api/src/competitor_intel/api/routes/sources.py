from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from competitor_intel.api.deps import get_api_user, require_api_role
from competitor_intel.api.serializers import serialize_source
from competitor_intel.config import settings
from competitor_intel.database import get_db, session_scope
from competitor_intel.models import Competitor, CrawlJob, Source, User
from competitor_intel.schemas import BulkSourceCreate, DiscoverRequest, SourceCreate, SourceUpdate
from competitor_intel.services.crawler import discover_links
from competitor_intel.services.pipeline import enqueue_manual_crawl, run_crawl_job


router = APIRouter(prefix="/api/sources", tags=["sources"])


@router.get("")
def list_sources(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    competitors = db.query(Competitor).filter(Competitor.tenant_id == user.tenant_id).order_by(Competitor.name.asc()).all()
    sources = (
        db.query(Source)
        .options(joinedload(Source.competitor))
        .filter(Source.tenant_id == user.tenant_id)
        .order_by(Source.updated_at.desc())
        .all()
    )
    return {
        "competitors": [{"id": item.id, "name": item.name} for item in competitors],
        "items": [serialize_source(item) for item in sources],
    }


@router.post("")
def create_source(payload: SourceCreate, user: User = Depends(require_api_role("admin")), db: Session = Depends(get_db)) -> dict:
    source = Source(
        tenant_id=user.tenant_id,
        competitor_id=payload.competitor_id,
        url=payload.url,
        source_type=payload.source_type,
        crawl_frequency_hours=payload.crawl_frequency_hours,
        extraction_strategy=payload.extraction_strategy,
        priority=payload.priority,
        screenshots_enabled=payload.screenshots_enabled,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return {"item": serialize_source(source)}


@router.post("/discover")
def discover_sources(
    payload: DiscoverRequest,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Fetch *seed_url*, extract internal links, optionally filtered by *include_pattern* regex.

    Returns a preview list — no database records are created.
    """
    try:
        links = discover_links(payload.seed_url, payload.include_pattern)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to fetch seed URL: {exc}")
    return {"seed_url": payload.seed_url, "discovered": links, "count": len(links)}


@router.post("/bulk-add")
def bulk_add_sources(
    payload: BulkSourceCreate,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Create multiple Source records at once, skipping URLs that already exist."""
    competitor = (
        db.query(Competitor)
        .filter(Competitor.id == payload.competitor_id, Competitor.tenant_id == user.tenant_id)
        .first()
    )
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")

    created_urls: list[str] = []
    skipped_urls: list[str] = []
    for url in payload.urls:
        existing = db.query(Source).filter(Source.tenant_id == user.tenant_id, Source.url == url).first()
        if existing:
            skipped_urls.append(url)
            continue
        db.add(
            Source(
                tenant_id=user.tenant_id,
                competitor_id=payload.competitor_id,
                url=url,
                source_type=payload.source_type,
                crawl_frequency_hours=payload.crawl_frequency_hours,
                extraction_strategy=payload.extraction_strategy,
                priority=payload.priority,
            )
        )
        created_urls.append(url)
    db.commit()
    return {"created": len(created_urls), "skipped": len(skipped_urls), "created_urls": created_urls}


@router.post("/{source_id}/crawl")
def trigger_crawl(source_id: str, user: User = Depends(require_api_role("admin", "analyst")), db: Session = Depends(get_db)) -> dict:
    source = db.query(Source).filter(Source.id == source_id, Source.tenant_id == user.tenant_id).first()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    job = enqueue_manual_crawl(db, source)
    db.commit()
    if settings.sync_manual_crawls:
        with session_scope() as sync_db:
            synced_job = sync_db.get(CrawlJob, job.id)
            if synced_job is not None:
                run_crawl_job(sync_db, synced_job)
    return {"job_id": job.id, "status": "queued"}


@router.patch("/{source_id}")
def update_source(
    source_id: str,
    payload: SourceUpdate,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    source = db.query(Source).filter(Source.id == source_id, Source.tenant_id == user.tenant_id).first()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, key, value)

    db.commit()
    db.refresh(source)
    return {"item": serialize_source(source)}
