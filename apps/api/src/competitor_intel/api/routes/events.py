from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from competitor_intel.api.deps import get_api_user, require_api_role
from competitor_intel.api.serializers import serialize_event
from competitor_intel.database import get_db
from competitor_intel.models import Competitor, Event, User
from competitor_intel.schemas import ReviewEventRequest
from competitor_intel.services.reviews import review_event


router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
def list_events(
    competitor_id: str | None = None,
    review_status: str | None = None,
    urgency: str | None = None,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    competitors = db.query(Competitor).filter(Competitor.tenant_id == user.tenant_id).order_by(Competitor.name.asc()).all()
    query = db.query(Event).options(joinedload(Event.competitor), joinedload(Event.diff_record)).filter(Event.tenant_id == user.tenant_id)
    if competitor_id:
        query = query.filter(Event.competitor_id == competitor_id)
    if review_status:
        query = query.filter(Event.review_status == review_status)
    if urgency:
        query = query.filter(Event.urgency == urgency)
    events = query.order_by(Event.detected_at.desc()).limit(100).all()
    return {
        "competitors": [{"id": item.id, "name": item.name} for item in competitors],
        "items": [serialize_event(item) for item in events],
    }


@router.patch("/{event_id}/review")
def patch_event_review(
    event_id: str,
    payload: ReviewEventRequest,
    user: User = Depends(require_api_role("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict:
    event = db.query(Event).filter(Event.id == event_id, Event.tenant_id == user.tenant_id).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    review_event(
        db,
        event,
        reviewer_user_id=user.id,
        action=payload.action,
        note=payload.note,
        event_type=payload.event_type,
        summary=payload.summary,
        urgency=payload.urgency,
        is_report_worthy=payload.is_report_worthy,
    )
    db.commit()
    event = db.query(Event).options(joinedload(Event.competitor), joinedload(Event.diff_record)).filter(Event.id == event.id).first()
    return {"item": serialize_event(event)}
