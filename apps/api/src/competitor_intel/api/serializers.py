from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from competitor_intel.models import Competitor, DiffRecord, Event, PageSnapshot, Report, ReportDefinition, Source, User


def _coerce(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [_coerce(item) for item in value]
    if isinstance(value, dict):
        return {key: _coerce(item) for key, item in value.items()}
    return value


def serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "tenant_id": user.tenant_id,
    }


def serialize_competitor(competitor: Competitor) -> dict[str, Any]:
    return {
        "id": competitor.id,
        "name": competitor.name,
        "slug": competitor.slug,
        "primary_domain": competitor.primary_domain,
        "segment": competitor.segment,
        "notes": competitor.notes,
        "is_active": competitor.is_active,
        "created_at": _coerce(competitor.created_at),
        "updated_at": _coerce(competitor.updated_at),
    }


def serialize_source(source: Source) -> dict[str, Any]:
    return {
        "id": source.id,
        "tenant_id": source.tenant_id,
        "competitor_id": source.competitor_id,
        "competitor_name": source.competitor.name if getattr(source, "competitor", None) else None,
        "url": source.url,
        "source_type": source.source_type,
        "crawl_frequency_hours": source.crawl_frequency_hours,
        "extraction_strategy": source.extraction_strategy,
        "priority": source.priority,
        "screenshots_enabled": source.screenshots_enabled,
        "is_active": source.is_active,
        "page_category": getattr(source, "page_category", None) or "other",
        "page_title": getattr(source, "page_title", None),
        "last_crawled_at": _coerce(source.last_crawled_at),
        "created_at": _coerce(source.created_at),
        "updated_at": _coerce(source.updated_at),
    }


def serialize_snapshot(snapshot: PageSnapshot) -> dict[str, Any]:
    return {
        "id": snapshot.id,
        "source_id": snapshot.source_id,
        "final_url": snapshot.final_url,
        "http_status": snapshot.http_status,
        "page_title": snapshot.page_title,
        "h1": snapshot.h1,
        "fetched_at": _coerce(snapshot.fetched_at),
        "created_at": _coerce(snapshot.created_at),
    }


def serialize_snapshot_detail(snapshot: PageSnapshot) -> dict[str, Any]:
    return {
        "id": snapshot.id,
        "source_id": snapshot.source_id,
        "crawl_job_id": snapshot.crawl_job_id,
        "final_url": snapshot.final_url,
        "http_status": snapshot.http_status,
        "page_title": snapshot.page_title,
        "h1": snapshot.h1,
        "meta_description": snapshot.meta_description,
        "canonical_url": snapshot.canonical_url,
        "extracted_text": snapshot.extracted_text,
        "extracted_blocks": _coerce(snapshot.extracted_blocks),
        "extracted_links": _coerce(snapshot.extracted_links),
        "metadata_json": _coerce(snapshot.metadata_json),
        "content_hash": snapshot.content_hash,
        "fetched_at": _coerce(snapshot.fetched_at),
        "created_at": _coerce(snapshot.created_at),
        "has_raw_html": bool(snapshot.raw_html_object_key),
    }


def serialize_diff_record(diff: DiffRecord) -> dict[str, Any]:
    return {
        "id": diff.id,
        "previous_snapshot_id": diff.previous_snapshot_id,
        "current_snapshot_id": diff.current_snapshot_id,
        "diff_status": diff.diff_status,
        "added_blocks": _coerce(diff.added_blocks),
        "removed_blocks": _coerce(diff.removed_blocks),
        "changed_headings": _coerce(diff.changed_headings),
        "changed_ctas": _coerce(diff.changed_ctas),
        "extracted_entities": _coerce(diff.extracted_entities),
        "noise_score": _coerce(diff.noise_score),
        "created_at": _coerce(diff.created_at),
    }


def serialize_event(event: Event) -> dict[str, Any]:
    diff_record = getattr(event, "diff_record", None)
    return {
        "id": event.id,
        "competitor_id": event.competitor_id,
        "competitor_name": event.competitor.name if getattr(event, "competitor", None) else None,
        "source_id": event.source_id,
        "event_type": event.event_type,
        "title": event.title,
        "summary": event.summary,
        "evidence_excerpt": event.evidence_excerpt,
        "source_url": event.source_url,
        "confidence_score": _coerce(event.confidence_score),
        "impact_score": _coerce(event.impact_score),
        "urgency": event.urgency,
        "review_status": event.review_status,
        "is_report_worthy": event.is_report_worthy,
        "ai_rationale": event.ai_rationale,
        "prompt_version": event.prompt_version,
        "detected_at": _coerce(event.detected_at),
        "captured_at": _coerce(diff_record.created_at if diff_record is not None else event.detected_at),
        "approved_at": _coerce(event.approved_at),
        "diff": {
            "id": diff_record.id,
            "added_blocks": _coerce(diff_record.added_blocks),
            "removed_blocks": _coerce(diff_record.removed_blocks),
            "changed_headings": _coerce(diff_record.changed_headings),
            "changed_ctas": _coerce(diff_record.changed_ctas),
            "extracted_entities": _coerce(diff_record.extracted_entities),
            "noise_score": _coerce(diff_record.noise_score),
            "diff_status": diff_record.diff_status,
        }
        if diff_record
        else None,
    }


def serialize_report_definition(defn: ReportDefinition, run_count: int = 0, last_run: Report | None = None) -> dict[str, Any]:
    from competitor_intel.services.reports import next_report_window

    window = next_report_window(last_run, defn.cadence_days)
    next_run_info = {
        "next_period_start": window["period_start"].isoformat(),
        "next_period_end": window["period_end"].isoformat(),
        "days_until_next": window["days_until_next"],
        "is_overdue": window["is_overdue"],
        "is_due": window["is_due"],
    }
    return {
        "id": defn.id,
        "title": defn.title,
        "report_type": defn.report_type,
        "cadence": defn.cadence,
        "cadence_days": defn.cadence_days,
        "focal_competitor_id": defn.focal_competitor_id,
        "comparison_competitor_ids": defn.comparison_competitor_ids or [],
        "auto_enabled": defn.auto_enabled,
        "email_enabled": defn.email_enabled,
        "email_recipients": defn.email_recipients or [],
        "is_active": defn.is_active,
        "run_count": run_count,
        "last_run": {
            "id": last_run.id,
            "title": last_run.title,
            "period_start": _coerce(last_run.period_start),
            "period_end": _coerce(last_run.period_end),
            "status": last_run.status,
            "generated_at": _coerce(last_run.generated_at),
        } if last_run else None,
        "next_run": next_run_info,
        "created_at": _coerce(defn.created_at),
        "updated_at": _coerce(defn.updated_at),
    }


def serialize_report(report: Report, events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": report.id,
        "definition_id": report.definition_id,
        "title": report.title,
        "period_start": _coerce(report.period_start),
        "period_end": _coerce(report.period_end),
        "cadence": report.cadence,
        "report_type": getattr(report, "report_type", "overview") or "overview",
        "focal_competitor_id": getattr(report, "focal_competitor_id", None),
        "status": report.status,
        "executive_summary": report.executive_summary,
        "key_changes_json": _coerce(report.key_changes_json),
        "cross_market_patterns": report.cross_market_patterns,
        "recommended_actions": report.recommended_actions,
        "html_download_url": f"/api/reports/runs/{report.id}/html" if report.html_object_key else None,
        "pdf_download_url": f"/api/reports/runs/{report.id}/pdf" if report.pdf_object_key else None,
        "generated_at": _coerce(report.generated_at),
        "published_at": _coerce(report.published_at),
        "created_at": _coerce(report.created_at),
        "events": events or [],
    }
