from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user
from competitor_intel.database import get_db
from competitor_intel.models import CrawlJob, Source, User
from competitor_intel.services.pipeline import enqueue_manual_crawl

router = APIRouter(prefix="/api/crawl-jobs", tags=["crawl-jobs"])


def _serialize_job(job: CrawlJob, source_url: str | None = None) -> dict:
    started = job.started_at
    finished = job.finished_at
    duration_seconds: float | None = None
    if started and finished:
        duration_seconds = (finished - started).total_seconds()
    return {
        "id": job.id,
        "source_id": job.source_id,
        "source_url": source_url,
        "trigger_type": job.trigger_type,
        "status": job.status,
        "started_at": started.isoformat() if started else None,
        "finished_at": finished.isoformat() if finished else None,
        "duration_seconds": duration_seconds,
        "http_status": job.http_status,
        "error_message": job.error_message,
        "log_lines": job.log_lines or [],
        "bytes_fetched": job.bytes_fetched,
        "changes_found": job.changes_found,
        "events_created": job.events_created,
        "created_at": job.created_at.isoformat(),
    }


@router.get("")
def list_crawl_jobs(
    competitor_id: str | None = None,
    source_id: str | None = None,
    limit: int = 30,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
):
    q = db.query(CrawlJob).filter(CrawlJob.tenant_id == user.tenant_id)
    if source_id:
        q = q.filter(CrawlJob.source_id == source_id)
    elif competitor_id:
        source_ids = (
            db.query(Source.id)
            .filter(Source.competitor_id == competitor_id, Source.tenant_id == user.tenant_id)
            .subquery()
        )
        q = q.filter(CrawlJob.source_id.in_(source_ids))
    jobs = q.order_by(CrawlJob.created_at.desc()).limit(limit).all()
    # Build a url lookup
    source_id_set = {j.source_id for j in jobs}
    sources = db.query(Source).filter(Source.id.in_(source_id_set)).all()
    url_by_id = {s.id: s.url for s in sources}
    return {"items": [_serialize_job(j, url_by_id.get(j.source_id)) for j in jobs]}


class EnqueueJobRequest(BaseModel):
    source_id: str


@router.post("")
def enqueue_job(
    payload: EnqueueJobRequest,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
):
    source = db.query(Source).filter(
        Source.id == payload.source_id, Source.tenant_id == user.tenant_id
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    # Check if already queued/running
    existing = (
        db.query(CrawlJob)
        .filter(CrawlJob.source_id == source.id, CrawlJob.status.in_(("queued", "running")))
        .first()
    )
    if existing:
        return {"item": _serialize_job(existing, source.url), "already_queued": True}
    job = enqueue_manual_crawl(db, source)
    db.commit()
    return {"item": _serialize_job(job, source.url), "already_queued": False}


@router.post("/{job_id}/cancel")
def cancel_job(
    job_id: str,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
):
    job = db.query(CrawlJob).filter(
        CrawlJob.id == job_id, CrawlJob.tenant_id == user.tenant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job with status '{job.status}'")
    job.status = "cancelled"
    job.finished_at = datetime.now(UTC)
    db.commit()
    source = db.query(Source).filter(Source.id == job.source_id).first()
    return {"item": _serialize_job(job, source.url if source else None)}
