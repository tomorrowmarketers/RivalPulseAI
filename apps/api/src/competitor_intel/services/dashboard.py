from __future__ import annotations

from collections import Counter
from datetime import UTC, date, datetime, timedelta

from sqlalchemy.orm import Session, joinedload

from competitor_intel.config import settings
from competitor_intel.models import Competitor, Event, Report, Source
from competitor_intel.services.system_status import build_system_status


def build_dashboard_data(db: Session, tenant_id: str, days: int = 14) -> dict:
    since = datetime.now(UTC) - timedelta(days=days)
    events = (
        db.query(Event)
        .options(joinedload(Event.competitor))
        .filter(Event.tenant_id == tenant_id, Event.detected_at >= since)
        .order_by(Event.detected_at.desc())
        .all()
    )
    competitors_tracked = db.query(Competitor).filter(Competitor.tenant_id == tenant_id, Competitor.is_active.is_(True)).count()
    monitored_urls = db.query(Source).filter(Source.tenant_id == tenant_id, Source.is_active.is_(True)).count()
    high_priority = sum(1 for event in events if event.urgency == "high")
    pending_reviews = sum(1 for event in events if event.review_status == "pending")
    approved_reviews = sum(1 for event in events if event.review_status == "approved")
    report_worthy_events = sum(1 for event in events if event.is_report_worthy)
    latest_events = [
        {
            "id": event.id,
            "competitor": event.competitor.name,
            "title": event.title,
            "event_type": event.event_type,
            "urgency": event.urgency,
            "detected_at": event.detected_at,
            "review_status": event.review_status,
            "prompt_version": event.prompt_version,
        }
        for event in events[:8]
    ]
    competitor_counts = Counter(event.competitor.name for event in events)
    event_type_counts = Counter(event.event_type for event in events)
    review_status_counts = Counter(event.review_status for event in events)
    top_competitors = [{"name": name, "count": count} for name, count in competitor_counts.most_common(5)]
    event_type_breakdown = [{"name": name, "count": count} for name, count in event_type_counts.most_common(6)]
    review_breakdown = {key: review_status_counts.get(key, 0) for key in ("pending", "approved", "edited", "dismissed")}
    system_status = build_system_status(db, tenant_id)

    next_actions: list[dict[str, str]] = []
    ai_status = system_status["ai"]
    pipeline_status = system_status["pipeline"]
    review_status = system_status["review"]
    if not ai_status["uses_live_gpt"]:
        next_actions.append(
            {
                "title": "Enable live GPT analysis",
                "detail": "Set OPENAI_API_KEY in the environment to switch event extraction and report synthesis from heuristic fallback to OpenAI.",
                "href": "/setup",
            }
        )
    if review_status["pending_events"] > 0:
        next_actions.append(
            {
                "title": f"Review {review_status['pending_events']} pending event(s)",
                "detail": "Approve, edit, or dismiss the analyst queue before generating the next report.",
                "href": "/events",
            }
        )
    if pipeline_status["stale_sources"] > 0:
        next_actions.append(
            {
                "title": f"Refresh {pipeline_status['stale_sources']} stale source(s)",
                "detail": "Some monitored pages are overdue for crawling based on their configured frequency.",
                "href": "/setup",
            }
        )
    if review_status["report_ready_events"] > 0:
        next_actions.append(
            {
                "title": f"Generate report from {review_status['report_ready_events']} approved event(s)",
                "detail": "The current approved queue is ready to be turned into a shareable report draft.",
                "href": "/outputs",
            }
        )

    return {
        "competitors_tracked": competitors_tracked,
        "monitored_urls": monitored_urls,
        "new_events": len(events),
        "high_priority_events": high_priority,
        "pending_reviews": pending_reviews,
        "approved_reviews": approved_reviews,
        "report_worthy_events": report_worthy_events,
        "latest_events": latest_events,
        "top_competitors": top_competitors,
        "event_type_breakdown": event_type_breakdown,
        "review_breakdown": review_breakdown,
        "system_status": system_status,
        "next_actions": next_actions,
        "report_schedule": _build_report_schedule(db, tenant_id),
    }


def _build_report_schedule(db: Session, tenant_id: str) -> dict:
    cadence_days = settings.report_cadence_days
    today = date.today()
    last_report = (
        db.query(Report)
        .filter(Report.tenant_id == tenant_id)
        .order_by(Report.period_end.desc())
        .first()
    )
    if last_report:
        next_start = last_report.period_end + timedelta(days=1)
        next_end = next_start + timedelta(days=cadence_days - 1)
        days_until = (next_end - today).days
    else:
        next_start = today - timedelta(days=cadence_days - 1)
        next_end = today
        days_until = 0
    return {
        "cadence_days": cadence_days,
        "auto_enabled": settings.auto_report_enabled,
        "email_enabled": settings.email_enabled,
        "last_report_end": last_report.period_end.isoformat() if last_report else None,
        "last_report_title": last_report.title if last_report else None,
        "last_report_id": last_report.id if last_report else None,
        "next_report_end": next_end.isoformat(),
        "days_until_next": max(0, days_until),
        "is_overdue": days_until < 0,
    }
