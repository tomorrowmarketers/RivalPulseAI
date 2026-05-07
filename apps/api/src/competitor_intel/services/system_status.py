from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from competitor_intel.models import CrawlJob, Event, Source
from competitor_intel.services.ai import serialize_ai_status


def build_system_status(db: Session, tenant_id: str) -> dict:
    now = datetime.now(UTC)
    active_sources = db.query(Source).filter(Source.tenant_id == tenant_id, Source.is_active.is_(True)).all()
    never_crawled = 0
    stale_sources = 0
    for source in active_sources:
        if source.last_crawled_at is None:
            never_crawled += 1
            stale_sources += 1
            continue
        last_crawled_at = source.last_crawled_at
        if last_crawled_at.tzinfo is None:
            last_crawled_at = last_crawled_at.replace(tzinfo=UTC)
        due_at = last_crawled_at + timedelta(hours=source.crawl_frequency_hours)
        if due_at <= now:
            stale_sources += 1

    queued_jobs = (
        db.query(CrawlJob)
        .filter(CrawlJob.tenant_id == tenant_id, CrawlJob.status.in_(("queued", "running")))
        .count()
    )
    failed_jobs_24h = (
        db.query(CrawlJob)
        .filter(
            CrawlJob.tenant_id == tenant_id,
            CrawlJob.status == "failed",
            CrawlJob.created_at >= now - timedelta(hours=24),
        )
        .count()
    )
    pending_events = db.query(Event).filter(Event.tenant_id == tenant_id, Event.review_status == "pending").count()
    approved_events = db.query(Event).filter(Event.tenant_id == tenant_id, Event.review_status == "approved").count()
    report_ready_events = (
        db.query(Event)
        .filter(
            Event.tenant_id == tenant_id,
            Event.review_status.in_(("approved", "edited")),
            Event.is_report_worthy.is_(True),
        )
        .count()
    )

    return {
        "ai": serialize_ai_status(),
        "pipeline": {
            "active_sources": len(active_sources),
            "never_crawled_sources": never_crawled,
            "stale_sources": stale_sources,
            "queued_jobs": queued_jobs,
            "failed_jobs_24h": failed_jobs_24h,
        },
        "review": {
            "pending_events": pending_events,
            "approved_events": approved_events,
            "report_ready_events": report_ready_events,
        },
    }
