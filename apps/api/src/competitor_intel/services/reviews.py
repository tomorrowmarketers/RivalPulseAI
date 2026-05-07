from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from competitor_intel.models import AuditLog, Event, EventReview


def review_event(
    db: Session,
    event: Event,
    reviewer_user_id: str,
    action: str,
    note: str | None = None,
    event_type: str | None = None,
    summary: str | None = None,
    urgency: str | None = None,
    is_report_worthy: bool | None = None,
) -> Event:
    old_value = {
        "event_type": event.event_type,
        "summary": event.summary,
        "urgency": event.urgency,
        "review_status": event.review_status,
        "is_report_worthy": event.is_report_worthy,
    }

    if action == "approve":
        event.review_status = "approved"
        event.approved_at = datetime.now(UTC)
    elif action == "dismiss":
        event.review_status = "dismissed"
    elif action == "edit":
        event.review_status = "edited"

    if event_type:
        event.event_type = event_type
    if summary:
        event.summary = summary
    if urgency:
        event.urgency = urgency
    if is_report_worthy is not None:
        event.is_report_worthy = is_report_worthy

    new_value = {
        "event_type": event.event_type,
        "summary": event.summary,
        "urgency": event.urgency,
        "review_status": event.review_status,
        "is_report_worthy": event.is_report_worthy,
    }
    db.add(
        EventReview(
            tenant_id=event.tenant_id,
            event_id=event.id,
            reviewer_user_id=reviewer_user_id,
            action=action,
            old_value=old_value,
            new_value=new_value,
            note=note,
        )
    )
    db.add(
        AuditLog(
            tenant_id=event.tenant_id,
            actor_user_id=reviewer_user_id,
            entity_type="event",
            entity_id=event.id,
            action=f"event_{action}",
            changes={"old": old_value, "new": new_value, "note": note},
        )
    )
    db.flush()
    return event
