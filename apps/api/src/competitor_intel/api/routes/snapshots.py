from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from competitor_intel.api.deps import get_api_user
from competitor_intel.api.serializers import (
    serialize_diff_record,
    serialize_snapshot,
    serialize_snapshot_detail,
    serialize_source,
)
from competitor_intel.database import get_db
from competitor_intel.models import CrawlJob, DiffRecord, PageSnapshot, Source, User


router = APIRouter(tags=["snapshots"])


def _load_source(db: Session, source_id: str, tenant_id: str) -> Source:
    source = (
        db.query(Source)
        .options(joinedload(Source.competitor))
        .filter(Source.id == source_id, Source.tenant_id == tenant_id)
        .first()
    )
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return source


@router.get("/api/sources/{source_id}/timeline")
def get_source_timeline(
    source_id: str,
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    source = _load_source(db, source_id, user.tenant_id)

    snapshots = (
        db.query(PageSnapshot)
        .filter(PageSnapshot.source_id == source.id, PageSnapshot.tenant_id == user.tenant_id)
        .order_by(PageSnapshot.fetched_at.desc())
        .limit(limit)
        .all()
    )

    diffs_by_current = {
        diff.current_snapshot_id: diff
        for diff in db.query(DiffRecord)
        .filter(DiffRecord.source_id == source.id, DiffRecord.tenant_id == user.tenant_id)
        .all()
    }

    failed_jobs = (
        db.query(CrawlJob)
        .filter(
            CrawlJob.source_id == source.id,
            CrawlJob.tenant_id == user.tenant_id,
            CrawlJob.status == "failed",
        )
        .order_by(CrawlJob.created_at.desc())
        .limit(10)
        .all()
    )

    items: list[dict] = []
    for snapshot in snapshots:
        diff = diffs_by_current.get(snapshot.id)
        items.append(
            {
                **serialize_snapshot(snapshot),
                "change_summary": _summarize_diff(diff),
                "diff_id": diff.id if diff else None,
                "diff_status": diff.diff_status if diff else "no_baseline",
                "noise_score": float(diff.noise_score) if diff and diff.noise_score is not None else None,
            }
        )

    return {
        "source": serialize_source(source),
        "items": items,
        "failed_jobs": [
            {
                "id": job.id,
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "error_message": job.error_message,
                "http_status": job.http_status,
            }
            for job in failed_jobs
        ],
    }


@router.get("/api/snapshots/{snapshot_id}")
def get_snapshot_detail(
    snapshot_id: str,
    include_html: bool = Query(False),
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    snapshot = (
        db.query(PageSnapshot)
        .filter(PageSnapshot.id == snapshot_id, PageSnapshot.tenant_id == user.tenant_id)
        .first()
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    diff = (
        db.query(DiffRecord)
        .filter(DiffRecord.current_snapshot_id == snapshot.id)
        .first()
    )

    raw_html: str | None = None
    if include_html and snapshot.raw_html_object_key:
        path = Path(snapshot.raw_html_object_key)
        if path.exists():
            try:
                raw_html = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                raw_html = None

    return {
        "snapshot": serialize_snapshot_detail(snapshot),
        "diff": serialize_diff_record(diff) if diff else None,
        "raw_html": raw_html,
    }


@router.get("/api/snapshots/{current_id}/diff/{previous_id}")
def get_pairwise_diff(
    current_id: str,
    previous_id: str,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    current = (
        db.query(PageSnapshot)
        .filter(PageSnapshot.id == current_id, PageSnapshot.tenant_id == user.tenant_id)
        .first()
    )
    previous = (
        db.query(PageSnapshot)
        .filter(PageSnapshot.id == previous_id, PageSnapshot.tenant_id == user.tenant_id)
        .first()
    )
    if current is None or previous is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if current.source_id != previous.source_id:
        raise HTTPException(status_code=400, detail="Snapshots belong to different sources")

    # Try cached diff record first (only valid when previous_id is exactly the prior snapshot stored)
    diff = (
        db.query(DiffRecord)
        .filter(
            DiffRecord.current_snapshot_id == current.id,
            DiffRecord.previous_snapshot_id == previous.id,
        )
        .first()
    )
    if diff is not None:
        return {
            "current": serialize_snapshot(current),
            "previous": serialize_snapshot(previous),
            "diff": serialize_diff_record(diff),
            "computed": False,
        }

    # On-demand pairwise diff (any two snapshots of same source)
    from competitor_intel.services.diffing import build_diff

    prev_blocks = previous.extracted_blocks or []
    curr_blocks = current.extracted_blocks or []
    prev_meta = previous.metadata_json or {}
    curr_meta = current.metadata_json or {}
    result = build_diff(
        previous_blocks=prev_blocks,
        current_blocks=curr_blocks,
        previous_headings=prev_meta.get("headings", []),
        current_headings=curr_meta.get("headings", []),
        previous_ctas=prev_meta.get("buttons", []),
        current_ctas=curr_meta.get("buttons", []),
    )

    return {
        "current": serialize_snapshot(current),
        "previous": serialize_snapshot(previous),
        "diff": {
            "id": None,
            "diff_status": result.diff_status,
            "added_blocks": result.added_blocks,
            "removed_blocks": result.removed_blocks,
            "changed_headings": result.changed_headings,
            "changed_ctas": result.changed_ctas,
            "extracted_entities": result.extracted_entities,
            "noise_score": result.noise_score,
        },
        "computed": True,
    }


def _summarize_diff(diff: DiffRecord | None) -> dict:
    if diff is None:
        return {"added": 0, "removed": 0, "headings": 0, "ctas": 0}
    return {
        "added": len(diff.added_blocks or []),
        "removed": len(diff.removed_blocks or []),
        "headings": len(diff.changed_headings or []),
        "ctas": len(diff.changed_ctas or []),
    }
