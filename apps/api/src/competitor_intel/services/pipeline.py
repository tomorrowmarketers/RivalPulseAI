from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from competitor_intel.models import AuditLog, Competitor, CrawlJob, DiffRecord, Event, PageSnapshot, Source
from competitor_intel.services.ai import classify_market_change
from competitor_intel.services.crawler import fetch_page
from competitor_intel.services.diffing import build_diff
from competitor_intel.services.embeddings import index_snapshot
from competitor_intel.services.classifier import ClassifiedEvent
from competitor_intel.storage import write_text


_URGENCY_SCORE = {"high": 2, "medium": 1, "low": 0}


def _select_primary_event(candidates: list[ClassifiedEvent]) -> ClassifiedEvent | None:
    if not candidates:
        return None

    primary = max(
        candidates,
        key=lambda item: (
            item.impact_score,
            item.confidence_score,
            1 if item.is_report_worthy else 0,
            _URGENCY_SCORE.get(item.urgency, 0),
            len(item.summary or ""),
        ),
    )
    if len(candidates) == 1:
        return primary

    return ClassifiedEvent(
        event_type=primary.event_type,
        title=primary.title,
        summary=primary.summary,
        evidence_excerpt=primary.evidence_excerpt,
        confidence_score=primary.confidence_score,
        impact_score=primary.impact_score,
        urgency=primary.urgency,
        is_report_worthy=primary.is_report_worthy,
        rationale=f"{primary.rationale}. Gop {len(candidates)} tin hieu cung URL va giu muc co tac dong cao nhat.",
    )


def enqueue_due_sources(db: Session) -> int:
    queued = 0
    sources = db.query(Source).filter(Source.is_active.is_(True)).all()
    now = datetime.now(UTC)
    for source in sources:
        due_at = source.last_crawled_at + timedelta(hours=source.crawl_frequency_hours) if source.last_crawled_at else None
        if due_at and due_at > now:
            continue
        existing = (
            db.query(CrawlJob)
            .filter(CrawlJob.source_id == source.id, CrawlJob.status.in_(("queued", "running")))
            .first()
        )
        if existing:
            continue
        db.add(CrawlJob(tenant_id=source.tenant_id, source_id=source.id, trigger_type="scheduled", status="queued"))
        queued += 1
    db.flush()
    return queued


def enqueue_manual_crawl(db: Session, source: Source) -> CrawlJob:
    job = CrawlJob(tenant_id=source.tenant_id, source_id=source.id, trigger_type="manual", status="queued")
    db.add(job)
    db.flush()
    return job


def process_next_crawl_job(db: Session) -> CrawlJob | None:
    job = (
        db.query(CrawlJob)
        .filter(CrawlJob.status == "queued")
        .order_by(CrawlJob.created_at.asc())
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        return None
    job.status = "running"
    job.started_at = datetime.now(UTC)
    db.flush()
    run_crawl_job(db, job, already_claimed=True)
    return job


def run_crawl_job(db: Session, job: CrawlJob, already_claimed: bool = False) -> CrawlJob:
    logs: list[dict] = []

    def _log(level: str, msg: str) -> None:
        logs.append({"ts": datetime.now(UTC).isoformat(), "level": level, "msg": msg})

    source = db.query(Source).filter(Source.id == job.source_id).first()
    if source is None:
        _log("error", "Source not found")
        job.status = "failed"
        job.error_message = "Source not found"
        job.finished_at = datetime.now(UTC)
        job.log_lines = logs
        db.flush()
        return job

    existing_snapshot = db.query(PageSnapshot).filter(PageSnapshot.crawl_job_id == job.id).first()
    if existing_snapshot is not None:
        _log("warning", "Crawl job da duoc xu ly truoc do, bo qua lan chay lap")
        if job.status != "succeeded":
            job.status = "succeeded"
        if job.started_at is None:
            job.started_at = existing_snapshot.fetched_at
        if job.finished_at is None:
            job.finished_at = datetime.now(UTC)
        job.log_lines = logs
        db.flush()
        return job

    if not already_claimed:
        job.status = "running"
        job.started_at = datetime.now(UTC)
        db.flush()

    try:
        _log("info", f"Fetching {source.url} ...")
        result = fetch_page(source.url)
        raw_size = len(result.raw_html.encode("utf-8")) if result.raw_html else 0
        _log("info", f"HTTP {result.http_status} · {raw_size / 1024:.1f} KB · {result.page_title or 'no title'}")

        def _strip_nul(s: str | None) -> str | None:
            return s.replace("\x00", "") if s else s

        raw_html_path = write_text(f"raw-html/{source.id}/{job.id}.html", result.raw_html)
        snapshot = PageSnapshot(
            tenant_id=source.tenant_id,
            source_id=source.id,
            crawl_job_id=job.id,
            final_url=_strip_nul(result.final_url),
            http_status=result.http_status,
            page_title=_strip_nul(result.page_title),
            h1=_strip_nul(result.h1),
            meta_description=_strip_nul(result.meta_description),
            canonical_url=_strip_nul(result.canonical_url),
            raw_html_object_key=raw_html_path,
            extracted_text=_strip_nul(result.extracted_text),
            extracted_blocks=result.extracted_blocks,
            extracted_links=result.extracted_links,
            content_hash=result.content_hash,
            metadata_json=result.metadata_json,
        )
        db.add(snapshot)
        db.flush()
        source.last_crawled_at = datetime.now(UTC)

        previous_snapshot = (
            db.query(PageSnapshot)
            .filter(PageSnapshot.source_id == source.id, PageSnapshot.id != snapshot.id)
            .order_by(PageSnapshot.fetched_at.desc())
            .first()
        )
        diff = create_diff_record(db, source, previous_snapshot, snapshot)
        changes_found = 0
        events_created = 0
        if diff and diff.diff_status == "detected":
            _log("info", f"Content changed — diff status: {diff.diff_status}")
            events = create_events_from_diff(db, source, diff)
            changes_found = 1
            events_created = len(events)
            _log("info", f"Created {events_created} event(s)")
        else:
            _log("info", "No content changes detected")

        try:
            index_snapshot(db, snapshot)
            _log("info", "Indexed snapshot for search")
        except Exception as emb_exc:
            _log("warning", f"Embedding index skipped: {emb_exc}")

        duration = (datetime.now(UTC) - job.started_at).total_seconds()
        _log("info", f"Done in {duration:.1f}s")

        job.status = "succeeded"
        job.http_status = result.http_status
        job.finished_at = datetime.now(UTC)
        job.log_lines = logs
        job.bytes_fetched = raw_size
        job.changes_found = changes_found
        job.events_created = events_created
        db.flush()
        return job
    except Exception as exc:
        _log("error", str(exc))
        job.status = "failed"
        job.error_message = str(exc)
        job.finished_at = datetime.now(UTC)
        job.log_lines = logs
        db.flush()
        return job


def create_diff_record(db: Session, source: Source, previous_snapshot: PageSnapshot | None, snapshot: PageSnapshot) -> DiffRecord:
    if previous_snapshot is None:
        # First crawl — treat all current content as "added" so AI can classify initial state
        current_headings = snapshot.metadata_json.get("headings", []) if snapshot.metadata_json else []
        current_ctas = snapshot.metadata_json.get("buttons", []) if snapshot.metadata_json else []
        added_blocks = snapshot.extracted_blocks or []
        diff = DiffRecord(
            tenant_id=source.tenant_id,
            source_id=source.id,
            previous_snapshot_id=None,
            current_snapshot_id=snapshot.id,
            diff_status="detected" if added_blocks or current_headings or current_ctas else "ignored_noise",
            added_blocks=added_blocks,
            removed_blocks=[],
            changed_headings=current_headings,
            changed_ctas=current_ctas,
            extracted_entities={},
            noise_score=0,
        )
        db.add(diff)
        db.flush()
        return diff

    previous_blocks = previous_snapshot.extracted_blocks if previous_snapshot else []
    previous_headings = previous_snapshot.metadata_json.get("headings", []) if previous_snapshot else []
    previous_ctas = previous_snapshot.metadata_json.get("buttons", []) if previous_snapshot else []
    current_headings = snapshot.metadata_json.get("headings", [])
    current_ctas = snapshot.metadata_json.get("buttons", [])

    diff_result = build_diff(
        previous_blocks=previous_blocks,
        current_blocks=snapshot.extracted_blocks,
        previous_headings=previous_headings,
        current_headings=current_headings,
        previous_ctas=previous_ctas,
        current_ctas=current_ctas,
    )

    diff = DiffRecord(
        tenant_id=source.tenant_id,
        source_id=source.id,
        previous_snapshot_id=previous_snapshot.id if previous_snapshot else None,
        current_snapshot_id=snapshot.id,
        diff_status=diff_result.diff_status,
        added_blocks=diff_result.added_blocks,
        removed_blocks=diff_result.removed_blocks,
        changed_headings=diff_result.changed_headings,
        changed_ctas=diff_result.changed_ctas,
        extracted_entities=diff_result.extracted_entities,
        noise_score=diff_result.noise_score,
    )
    db.add(diff)
    db.flush()
    return diff


def create_events_from_diff(db: Session, source: Source, diff: DiffRecord) -> list[Event]:
    competitor = db.query(Competitor).filter(Competitor.id == source.competitor_id).first()
    if competitor is None:
        return []
    existing = db.query(Event).filter(Event.diff_record_id == diff.id).all()
    for item in existing:
        db.delete(item)
    db.flush()

    events: list[Event] = []
    classified_batch = classify_market_change(competitor, source, diff)
    classified = _select_primary_event(classified_batch.events)
    if classified is None:
        return events

    event = Event(
        tenant_id=source.tenant_id,
        competitor_id=competitor.id,
        source_id=source.id,
        diff_record_id=diff.id,
        event_type=classified.event_type,
        title=classified.title,
        summary=classified.summary,
        evidence_excerpt=classified.evidence_excerpt,
        source_url=source.url,
        confidence_score=classified.confidence_score,
        impact_score=classified.impact_score,
        urgency=classified.urgency,
        is_report_worthy=classified.is_report_worthy,
        ai_rationale=classified.rationale,
        prompt_version=classified_batch.prompt_version,
    )
    db.add(event)
    db.flush()
    db.add(
        AuditLog(
            tenant_id=source.tenant_id,
            entity_type="event",
            entity_id=event.id,
            action="event_created",
            changes={"event_type": event.event_type, "source_url": event.source_url},
        )
    )
    events.append(event)
    db.flush()
    return events
