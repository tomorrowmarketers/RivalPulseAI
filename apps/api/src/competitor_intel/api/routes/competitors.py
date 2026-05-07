from __future__ import annotations

import re
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user, require_api_role
from competitor_intel.api.serializers import serialize_competitor, serialize_event, serialize_snapshot, serialize_source
from competitor_intel.database import get_db
from competitor_intel.models import (
    AuditLog,
    Competitor,
    CrawlJob,
    DiffRecord,
    DiscoveredLink,
    DiscoverySeed,
    Event,
    EventReview,
    PageSnapshot,
    ReportEvent,
    SnapshotChunk,
    Source,
    User,
)
from competitor_intel.schemas import CompetitorCreate, CompetitorUpdate


router = APIRouter(prefix="/api/competitors", tags=["competitors"])


def _slugify(value: str) -> str:
    lowered = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "competitor"


def _normalize_domain(value: str) -> str:
    raw = value.strip()
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    return (parsed.netloc or parsed.path).lower().strip("/")


def _build_unique_slug(db: Session, tenant_id: str, requested_slug: str) -> str:
    base = _slugify(requested_slug)
    candidate = base
    suffix = 2
    while db.query(Competitor).filter(Competitor.tenant_id == tenant_id, Competitor.slug == candidate).first():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


@router.get("")
def list_competitors(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    competitors = db.query(Competitor).filter(Competitor.tenant_id == user.tenant_id).order_by(Competitor.name.asc()).all()
    return {"items": [serialize_competitor(item) for item in competitors]}


@router.post("")
def create_competitor(payload: CompetitorCreate, user: User = Depends(require_api_role("admin")), db: Session = Depends(get_db)) -> dict:
    slug = _build_unique_slug(db, user.tenant_id, payload.slug or payload.name)
    competitor = Competitor(
        tenant_id=user.tenant_id,
        name=payload.name,
        slug=slug,
        primary_domain=_normalize_domain(payload.primary_domain),
        segment=payload.segment,
        notes=payload.notes,
    )
    db.add(competitor)
    db.commit()
    return {"item": serialize_competitor(competitor)}


@router.get("/{competitor_id}")
def competitor_detail(competitor_id: str, user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    competitor = db.query(Competitor).filter(Competitor.id == competitor_id, Competitor.tenant_id == user.tenant_id).first()
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")
    sources = db.query(Source).filter(Source.competitor_id == competitor.id).order_by(Source.source_type.asc()).all()
    events = db.query(Event).filter(Event.competitor_id == competitor.id).order_by(Event.detected_at.desc()).limit(20).all()
    snapshots = (
        db.query(PageSnapshot)
        .join(Source, Source.id == PageSnapshot.source_id)
        .filter(Source.competitor_id == competitor.id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(10)
        .all()
    )
    return {
        "competitor": serialize_competitor(competitor),
        "sources": [serialize_source(item) for item in sources],
        "events": [serialize_event(item) for item in events],
        "snapshots": [serialize_snapshot(item) for item in snapshots],
    }


@router.patch("/{competitor_id}")
def update_competitor(
    competitor_id: str,
    payload: CompetitorUpdate,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    competitor = db.query(Competitor).filter(
        Competitor.id == competitor_id, Competitor.tenant_id == user.tenant_id
    ).first()
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "primary_domain" and value:
            value = _normalize_domain(str(value))
        setattr(competitor, key, value)
    db.commit()
    db.refresh(competitor)
    return {"item": serialize_competitor(competitor)}


def _count_competitor_resources(db: Session, competitor_id: str) -> dict[str, int]:
    """Count resources that would be removed when deleting this competitor."""
    source_ids = [s.id for s in db.query(Source.id).filter(Source.competitor_id == competitor_id).all()]
    seed_ids = [s.id for s in db.query(DiscoverySeed.id).filter(DiscoverySeed.competitor_id == competitor_id).all()]
    snapshot_ids = (
        db.query(PageSnapshot.id).filter(PageSnapshot.source_id.in_(source_ids)).all()
        if source_ids else []
    )
    snapshot_id_list = [row.id for row in snapshot_ids]

    return {
        "sources": len(source_ids),
        "seeds": len(seed_ids),
        "discovered_links": (
            db.query(DiscoveredLink).filter(DiscoveredLink.seed_id.in_(seed_ids)).count() if seed_ids else 0
        ),
        "crawl_jobs": (
            db.query(CrawlJob).filter(CrawlJob.source_id.in_(source_ids)).count() if source_ids else 0
        ),
        "snapshots": len(snapshot_id_list),
        "events": db.query(Event).filter(Event.competitor_id == competitor_id).count(),
    }


@router.get("/{competitor_id}/history")
def competitor_history(
    competitor_id: str,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return all sources for this competitor with their snapshot versions."""
    competitor = db.query(Competitor).filter(
        Competitor.id == competitor_id, Competitor.tenant_id == user.tenant_id
    ).first()
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")

    sources = (
        db.query(Source)
        .filter(Source.competitor_id == competitor_id)
        .order_by(Source.page_category.asc(), Source.url.asc())
        .all()
    )

    result = []
    for src in sources:
        snapshots = (
            db.query(PageSnapshot)
            .filter(PageSnapshot.source_id == src.id)
            .order_by(PageSnapshot.fetched_at.asc())
            .all()
        )

        snapshot_data = []
        for version_num, snap in enumerate(snapshots, start=1):
            # Check if this snapshot had changes vs previous
            # DiffRecord already imported at module level
            diff = db.query(DiffRecord).filter(
                DiffRecord.current_snapshot_id == snap.id
            ).first()
            has_changes = diff is not None and diff.diff_status == "detected"
            change_count = (
                len(diff.added_blocks or []) + len(diff.removed_blocks or [])
                if diff else 0
            )
            snapshot_data.append({
                "version": version_num,
                "snapshot_id": snap.id,
                "fetched_at": snap.fetched_at.isoformat(),
                "content_hash": snap.content_hash,
                "page_title": snap.page_title,
                "http_status": snap.http_status,
                "has_changes": has_changes,
                "change_count": change_count,
            })

        result.append({
            "id": src.id,
            "url": src.url,
            "page_category": src.page_category,
            "source_type": src.source_type,
            "is_active": src.is_active,
            "last_crawled_at": src.last_crawled_at.isoformat() if src.last_crawled_at else None,
            "snapshot_count": len(snapshots),
            "snapshots": snapshot_data,
        })

    return {
        "competitor": serialize_competitor(competitor),
        "sources": result,
    }


@router.get("/{competitor_id}/delete-impact")
def competitor_delete_impact(
    competitor_id: str,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Return counts of resources that would be deleted alongside the competitor."""
    competitor = db.query(Competitor).filter(
        Competitor.id == competitor_id, Competitor.tenant_id == user.tenant_id
    ).first()
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")
    return {
        "competitor": serialize_competitor(competitor),
        "impact": _count_competitor_resources(db, competitor_id),
    }


@router.delete("/{competitor_id}")
def delete_competitor(
    competitor_id: str,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Hard-delete competitor and all dependent rows.

    Performs explicit ordered deletion since SQLite does not enforce FK CASCADE
    by default. Wrapped in a single transaction — rolls back on any failure.
    """
    competitor = db.query(Competitor).filter(
        Competitor.id == competitor_id, Competitor.tenant_id == user.tenant_id
    ).first()
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")

    impact = _count_competitor_resources(db, competitor_id)
    competitor_name = competitor.name

    source_ids = [row.id for row in db.query(Source.id).filter(Source.competitor_id == competitor_id).all()]
    seed_ids = [row.id for row in db.query(DiscoverySeed.id).filter(DiscoverySeed.competitor_id == competitor_id).all()]
    event_ids = [row.id for row in db.query(Event.id).filter(Event.competitor_id == competitor_id).all()]
    snapshot_ids = (
        [row.id for row in db.query(PageSnapshot.id).filter(PageSnapshot.source_id.in_(source_ids)).all()]
        if source_ids else []
    )

    try:
        # 1. Event-side: reviews + report links → events
        if event_ids:
            db.query(EventReview).filter(EventReview.event_id.in_(event_ids)).delete(synchronize_session=False)
            db.query(ReportEvent).filter(ReportEvent.event_id.in_(event_ids)).delete(synchronize_session=False)
            db.query(Event).filter(Event.id.in_(event_ids)).delete(synchronize_session=False)

        # 2. Source-side: chunks + diffs + snapshots + crawl jobs → sources
        if source_ids:
            db.query(SnapshotChunk).filter(SnapshotChunk.source_id.in_(source_ids)).delete(synchronize_session=False)
            db.query(DiffRecord).filter(DiffRecord.source_id.in_(source_ids)).delete(synchronize_session=False)
            if snapshot_ids:
                db.query(PageSnapshot).filter(PageSnapshot.id.in_(snapshot_ids)).delete(synchronize_session=False)
            db.query(CrawlJob).filter(CrawlJob.source_id.in_(source_ids)).delete(synchronize_session=False)
            db.query(Source).filter(Source.id.in_(source_ids)).delete(synchronize_session=False)

        # 3. Discovery-side: links → seeds
        if seed_ids:
            db.query(DiscoveredLink).filter(DiscoveredLink.seed_id.in_(seed_ids)).delete(synchronize_session=False)
            db.query(DiscoverySeed).filter(DiscoverySeed.id.in_(seed_ids)).delete(synchronize_session=False)

        # 4. Audit log entry, then competitor itself
        db.add(AuditLog(
            tenant_id=user.tenant_id,
            actor_user_id=user.id,
            entity_type="competitor",
            entity_id=competitor_id,
            action="delete",
            changes={"name": competitor_name, "impact": impact},
        ))
        db.delete(competitor)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"deleted": True, "id": competitor_id, "impact": impact}
