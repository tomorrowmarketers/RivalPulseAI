from __future__ import annotations

import json
import queue
import threading
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user, require_api_role
from competitor_intel.database import get_db
from competitor_intel.models import Competitor, DiscoveredLink, DiscoverySeed, User
from competitor_intel.schemas import (
    ApproveLinkRequest,
    DiscoveryPreviewRequest,
    DiscoverySeedCreate,
    DiscoverySeedUpdate,
    RejectLinkRequest,
)
from competitor_intel.services.link_discovery import (
    CATEGORIES,
    CategorisedLink,
    approve_links,
    finalize_seed_setup,
    reject_links,
    rescan_due_seeds,
    scan_and_categorise_deep,
)
from competitor_intel.services.url_utils import canonicalize_monitored_url

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


class FinalizeSetupRequest(BaseModel):
    selected_ids: list[str]
    crawl_frequency_hours: int = 48


def _serialize_link(link: DiscoveredLink) -> dict:
    return {
        "id": link.id,
        "url": link.url,
        "link_text": link.link_text,
        "page_title": link.page_title,
        "category": link.category,
        "source_type": link.source_type,
        "ai_reason": link.ai_reason,
        "status": link.status,
        "is_new": link.is_new,
        "first_seen_at": link.first_seen_at.isoformat() if link.first_seen_at else None,
        "source_id": link.source_id,
    }


def _serialize_seed(seed: DiscoverySeed) -> dict:
    return {
        "id": seed.id,
        "competitor_id": seed.competitor_id,
        "competitor_name": seed.competitor.name if seed.competitor else None,
        "seed_url": seed.seed_url,
        "label": seed.label,
        "scan_frequency_hours": seed.scan_frequency_hours,
        "last_scanned_at": seed.last_scanned_at.isoformat() if seed.last_scanned_at else None,
        "pending_count": seed.pending_count,
        "is_active": seed.is_active,
        "auto_approve_new_links": seed.auto_approve_new_links,
        "auto_source_type": seed.auto_source_type,
        "auto_approve_source_types": list(seed.auto_approve_source_types or []),
        "auto_crawl_frequency_hours": seed.auto_crawl_frequency_hours,
    }


def _group_categorised_links(categorised: list[CategorisedLink]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}
    seen_urls: set[str] = set()
    for item in categorised:
        if item.url in seen_urls:
            continue
        seen_urls.add(item.url)
        grouped.setdefault(item.category, []).append({
            "url": item.url,
            "link_text": item.link_text,
            "page_title": item.page_title,
            "source_type": item.source_type,
            "ai_reason": item.ai_reason,
            "category": item.category,
        })
    return grouped


def _seed_host(seed_url: str) -> str:
    parsed = urlparse(seed_url if '://' in seed_url else f'https://{seed_url}')
    return parsed.netloc.lower().removeprefix('www.')


# ─── Deep Preview (no DB write) ──────────────────────────────────────────────

@router.post("/preview")
def preview_links(
    payload: DiscoveryPreviewRequest,
    user: User = Depends(require_api_role("admin")),
) -> dict:
    """Deep-crawl domain (BFS), run AI categorisation → return grouped preview."""
    try:
        categorised = scan_and_categorise_deep(payload.seed_url)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to fetch seed URL: {exc}")

    grouped = _group_categorised_links(categorised)

    return {
        "seed_url": payload.seed_url,
        "total": sum(len(items) for items in grouped.values()),
        "categories": CATEGORIES,
        "grouped": grouped,
    }


@router.get("/preview-stream")
def preview_links_stream(
    seed_url: str = Query(..., min_length=1),
    user: User = Depends(require_api_role("admin")),
) -> StreamingResponse:
    """Stream deep-scan progress so the UI can show live logs while waiting."""
    messages: queue.Queue[dict] = queue.Queue()

    def emit(message: str) -> None:
        messages.put({"type": "log", "message": message})

    def worker() -> None:
        try:
            categorised = scan_and_categorise_deep(seed_url, progress=emit)
            grouped = _group_categorised_links(categorised)
            messages.put({
                "type": "result",
                "seed_url": seed_url,
                "total": sum(len(items) for items in grouped.values()),
                "categories": CATEGORIES,
                "grouped": grouped,
            })
        except Exception as exc:
            messages.put({"type": "error", "message": f"Failed to fetch seed URL: {exc}"})
        finally:
            messages.put({"type": "done"})

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            item = messages.get()
            if item.get("type") == "done":
                break
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── Seed CRUD ─────────────────────────────────────────────────────────────────

@router.get("/seeds")
def list_seeds(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    seeds = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.tenant_id == user.tenant_id, DiscoverySeed.is_active.is_(True))
        .order_by(DiscoverySeed.created_at.desc())
        .all()
    )
    return {"items": [_serialize_seed(s) for s in seeds]}


@router.post("/seeds")
def create_seed(
    payload: DiscoverySeedCreate,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Create a DiscoverySeed and run the initial deep categorisation scan."""
    competitor = (
        db.query(Competitor)
        .filter(Competitor.id == payload.competitor_id, Competitor.tenant_id == user.tenant_id)
        .first()
    )
    if competitor is None:
        raise HTTPException(status_code=404, detail="Competitor not found")

    normalized_seed_host = _seed_host(payload.seed_url)
    existing = next(
        (
            item for item in db.query(DiscoverySeed)
            .filter(DiscoverySeed.tenant_id == user.tenant_id, DiscoverySeed.is_active.is_(True))
            .all()
            if _seed_host(item.seed_url) == normalized_seed_host
        ),
        None,
    )
    if existing:
        competitor_name = existing.competitor.name if existing.competitor else existing.seed_url
        raise HTTPException(status_code=409, detail=f"Domain nay da duoc theo doi boi {competitor_name}.")

    seed = DiscoverySeed(
        tenant_id=user.tenant_id,
        competitor_id=payload.competitor_id,
        seed_url=payload.seed_url,
        label=payload.label or payload.seed_url,
        scan_frequency_hours=payload.scan_frequency_hours,
        auto_approve_new_links=payload.auto_approve_new_links,
        auto_source_type=payload.auto_source_type,
        auto_crawl_frequency_hours=payload.auto_crawl_frequency_hours,
    )
    db.add(seed)
    db.flush()

    if payload.discovered_links:
        categorised = [
            CategorisedLink(
                url=canonicalize_monitored_url(item.url),
                link_text=item.link_text,
                page_title=item.page_title,
                category=item.category,
                ai_reason=item.ai_reason,
                source_type=item.source_type,
            )
            for item in payload.discovered_links
        ]
    else:
        try:
            categorised = scan_and_categorise_deep(payload.seed_url)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=422, detail=f"Failed to fetch seed URL: {exc}")

    from datetime import UTC, datetime
    now = datetime.now(UTC)
    # Final dedup by URL — catches any remaining duplicates from redirect chains
    seen_urls: set[str] = set()
    unique_links = []
    for item in categorised:
        item.url = canonicalize_monitored_url(item.url)
        if item.url not in seen_urls:
            seen_urls.add(item.url)
            unique_links.append(item)
    for item in unique_links:
        db.add(
            DiscoveredLink(
                tenant_id=user.tenant_id,
                seed_id=seed.id,
                url=item.url,
                link_text=item.link_text,
                page_title=item.page_title,
                category=item.category,
                ai_reason=item.ai_reason,
                source_type=item.source_type,
                status="pending",
                is_new=True,
                first_seen_at=now,
                last_seen_at=now,
            )
        )

    seed.last_scanned_at = now
    seed.pending_count = len(unique_links)
    db.commit()
    db.refresh(seed)
    return {"item": _serialize_seed(seed), "link_count": len(unique_links)}


@router.patch("/seeds/{seed_id}")
def update_seed(
    seed_id: str,
    payload: DiscoverySeedUpdate,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(seed, field, value)
    db.commit()
    db.refresh(seed)
    return {"item": _serialize_seed(seed)}


@router.delete("/seeds/{seed_id}")
def delete_seed(
    seed_id: str,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")
    seed.is_active = False
    db.commit()
    return {"ok": True}


# ─── Links for a seed ──────────────────────────────────────────────────────────

@router.get("/seeds/{seed_id}/links")
def list_seed_links(
    seed_id: str,
    status: str | None = None,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")

    q = db.query(DiscoveredLink).filter(DiscoveredLink.seed_id == seed_id)
    if status:
        q = q.filter(DiscoveredLink.status == status)
    links = q.order_by(DiscoveredLink.category.asc(), DiscoveredLink.first_seen_at.desc()).all()

    # Group by category
    grouped: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}
    for link in links:
        grouped.setdefault(link.category, []).append(_serialize_link(link))

    return {
        "seed": _serialize_seed(seed),
        "grouped": grouped,
        "categories": CATEGORIES,
        "total": len(links),
    }


@router.post("/seeds/{seed_id}/approve")
def approve_seed_links(
    seed_id: str,
    payload: ApproveLinkRequest,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")
    created = approve_links(db, seed, payload.link_ids, payload.source_type, payload.crawl_frequency_hours)
    db.commit()
    return {"created_sources": len(created), "source_ids": [s.id for s in created]}


@router.post("/seeds/{seed_id}/reject")
def reject_seed_links(
    seed_id: str,
    payload: RejectLinkRequest,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")
    count = reject_links(db, seed, payload.link_ids)
    db.commit()
    return {"rejected": count}


@router.post("/seeds/{seed_id}/rescan")
def manual_rescan(
    seed_id: str,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Force an immediate re-scan of a specific seed."""
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")
    seed.last_scanned_at = None
    db.flush()
    new_count = rescan_due_seeds(db, seed_ids=[seed.id], force=True)
    return {"new_links_found": new_count}


@router.post("/seeds/{seed_id}/finalize")
def finalize_setup(
    seed_id: str,
    payload: FinalizeSetupRequest,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Finalize wizard setup: create Sources for ALL discovered links.
    Selected → is_active=True (crawled). Others → is_active=False (archived as v1).
    """
    seed = (
        db.query(DiscoverySeed)
        .filter(DiscoverySeed.id == seed_id, DiscoverySeed.tenant_id == user.tenant_id)
        .first()
    )
    if seed is None:
        raise HTTPException(status_code=404, detail="Seed not found")
    result = finalize_seed_setup(db, seed, payload.selected_ids, payload.crawl_frequency_hours)
    db.commit()
    return result
