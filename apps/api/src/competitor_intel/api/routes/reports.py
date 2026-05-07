from __future__ import annotations

from datetime import date, datetime, timedelta, UTC

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from competitor_intel.api.deps import get_api_user, require_api_role
from competitor_intel.api.serializers import serialize_event, serialize_report, serialize_report_definition
from competitor_intel.config import settings
from competitor_intel.database import get_db
from competitor_intel.models import (
    Competitor, Event, Report, ReportDefinition, ReportEvent, Source, User, new_id, utcnow,
)
from competitor_intel.schemas import (
    AdhocReportRequest, ReportCreate, ReportDefinitionCreate, ReportDefinitionUpdate, ReportRunCreate,
)
from competitor_intel.services.adhoc_report import build_adhoc_report
from competitor_intel.services.notifications import write_notification
from competitor_intel.services.reports import generate_report


router = APIRouter(prefix="/api/reports", tags=["reports"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_def(def_id: str, tenant_id: str, db: Session) -> ReportDefinition:
    defn = db.query(ReportDefinition).filter(
        ReportDefinition.id == def_id, ReportDefinition.tenant_id == tenant_id,
    ).first()
    if defn is None:
        raise HTTPException(status_code=404, detail="Report definition not found")
    return defn


def _get_run(run_id: str, tenant_id: str, db: Session) -> Report:
    run = db.query(Report).filter(Report.id == run_id, Report.tenant_id == tenant_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="Report run not found")
    return run


def _def_summary(defn: ReportDefinition, db: Session) -> dict:
    run_count = db.query(func.count(Report.id)).filter(Report.definition_id == defn.id).scalar() or 0
    last_run = (
        db.query(Report)
        .filter(Report.definition_id == defn.id)
        .order_by(Report.created_at.desc())
        .first()
    )
    return serialize_report_definition(defn, run_count=run_count, last_run=last_run)


# ── Global schedule (backward compat + overview page) ─────────────────────────

@router.get("/schedule")
def report_schedule(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    """Return scheduling metadata: cadence, last report, next expected report date."""
    cadence_days = settings.report_cadence_days
    today = date.today()

    last_report = (
        db.query(Report)
        .filter(Report.tenant_id == user.tenant_id)
        .order_by(Report.period_end.desc())
        .first()
    )

    if last_report:
        next_report_start = last_report.period_end + timedelta(days=1)
        next_report_end = next_report_start + timedelta(days=cadence_days - 1)
        days_until_next = (next_report_end - today).days
    else:
        next_report_start = today - timedelta(days=cadence_days - 1)
        next_report_end = today
        days_until_next = 0

    return {
        "cadence_days": cadence_days,
        "auto_report_enabled": settings.auto_report_enabled,
        "email_enabled": settings.email_enabled,
        "email_recipients": [r.strip() for r in settings.report_email_recipients.split(",") if r.strip()],
        "last_report": {
            "id": last_report.id,
            "title": last_report.title,
            "period_end": last_report.period_end.isoformat(),
            "status": last_report.status,
        } if last_report else None,
        "next_report_start": next_report_start.isoformat(),
        "next_report_end": next_report_end.isoformat(),
        "days_until_next": max(0, days_until_next),
        "is_overdue": days_until_next < 0,
    }


@router.get("")
def list_definitions(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    """List all report definitions for the tenant."""
    defs = (
        db.query(ReportDefinition)
        .filter(ReportDefinition.tenant_id == user.tenant_id)
        .order_by(ReportDefinition.created_at.desc())
        .all()
    )
    return {"items": [_def_summary(d, db) for d in defs]}


@router.post("")
def create_definition(
    payload: ReportDefinitionCreate,
    user: User = Depends(require_api_role("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict:
    """Create a new report definition (template)."""
    defn = ReportDefinition(
        id=new_id(),
        tenant_id=user.tenant_id,
        title=payload.title,
        report_type=payload.report_type,
        cadence=payload.cadence,
        cadence_days=payload.cadence_days,
        focal_competitor_id=payload.focal_competitor_id,
        comparison_competitor_ids=payload.comparison_competitor_ids,
        auto_enabled=payload.auto_enabled,
        email_enabled=payload.email_enabled,
        email_recipients=payload.email_recipients,
    )
    db.add(defn)
    db.commit()
    db.refresh(defn)
    return {"item": _def_summary(defn, db)}


@router.post("/adhoc")
def adhoc_report(
    payload: AdhocReportRequest,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    result = build_adhoc_report(
        db,
        tenant_id=user.tenant_id,
        question=payload.question,
        competitor_ids=payload.competitor_ids or None,
        source_ids=payload.source_ids or None,
        days=payload.days,
        title=payload.title,
    )
    return {
        "title": result.title,
        "answer": result.answer,
        "period_start": result.period_start,
        "period_end": result.period_end,
        "sources_used": result.sources_used,
        "competitors_used": result.competitors_used,
        "event_count": result.event_count,
        "diff_count": result.diff_count,
        "provider": result.provider,
        "detail": result.detail,
    }



# ── Comparison (cross-domain by 3 categories) ─────────────────────────────────

_CATEGORY_MAP: dict[str, str] = {
    "product_launch": "san_pham",
    "product_update": "san_pham",
    "pricing_change": "san_pham",
    "schedule_change": "san_pham",
    "enterprise_offer_change": "khuyen_mai",
    "promotion_launch": "khuyen_mai",
    "promotion_update": "khuyen_mai",
    "testimonial_or_social_proof": "khuyen_mai",
    "hiring_signal": "other",
    "content_campaign": "other",
    "partnership_update": "other",
    "positioning_change": "other",
    "other": "other",
}


@router.get("/comparison")
def comparison_report(
    days: int = 30,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    """Cross-domain comparison: events per competitor grouped by 3 categories."""
    cutoff = datetime.now(UTC).date() - timedelta(days=days)

    competitors = (
        db.query(Competitor)
        .filter(Competitor.tenant_id == user.tenant_id, Competitor.is_active.is_(True))
        .order_by(Competitor.name.asc())
        .all()
    )

    events = (
        db.query(Event)
        .join(Source, Source.id == Event.source_id)
        .filter(
            Event.tenant_id == user.tenant_id,
            Event.detected_at >= datetime.combine(cutoff, datetime.min.time()).replace(tzinfo=UTC),
        )
        .all()
    )

    # Group events by competitor → category
    data: dict[str, dict] = {}
    for comp in competitors:
        data[comp.id] = {
            "name": comp.name,
            "domain": comp.primary_domain,
            "san_pham": [],
            "khuyen_mai": [],
            "other": [],
        }

    for ev in events:
        if ev.competitor_id not in data:
            continue
        # Use source's page_category first, fall back to event_type mapping
        src = db.query(Source).filter(Source.id == ev.source_id).first()
        if src and src.page_category in ("san_pham", "khuyen_mai", "other"):
            cat = src.page_category
        else:
            cat = _CATEGORY_MAP.get(ev.event_type, "other")

        data[ev.competitor_id][cat].append({
            "id": ev.id,
            "title": ev.title,
            "event_type": ev.event_type,
            "urgency": ev.urgency,
            "detected_at": ev.detected_at.isoformat() if ev.detected_at else None,
            "source_url": ev.source_url,
        })

    # Convert lists to counts + latest events
    for comp_id, row in data.items():
        for cat in ("san_pham", "khuyen_mai", "other"):
            events_list = row[cat]
            row[cat] = {
                "count": len(events_list),
                "latest": events_list[:3],  # most recent 3
            }

    return {
        "days": days,
        "competitors": [{"id": c.id, "name": c.name, "domain": c.primary_domain} for c in competitors],
        "categories": {"san_pham": "Sản phẩm", "khuyen_mai": "Khuyến mại", "other": "Khác"},
        "data": data,
    }


@router.get("/{def_id}")
def get_definition(def_id: str, user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    defn = _get_def(def_id, user.tenant_id, db)
    return {"item": _def_summary(defn, db)}


@router.patch("/{def_id}")
def update_definition(
    def_id: str,
    payload: ReportDefinitionUpdate,
    user: User = Depends(require_api_role("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict:
    defn = _get_def(def_id, user.tenant_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(defn, field, value)
    defn.updated_at = utcnow()
    db.commit()
    db.refresh(defn)
    return {"item": _def_summary(defn, db)}


@router.delete("/{def_id}")
def delete_definition(
    def_id: str,
    user: User = Depends(require_api_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    defn = _get_def(def_id, user.tenant_id, db)
    db.delete(defn)
    db.commit()
    return {"deleted": True}


# ── Runs (per definition) ─────────────────────────────────────────────────────

@router.get("/{def_id}/runs")
def list_runs(def_id: str, user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    defn = _get_def(def_id, user.tenant_id, db)
    runs = (
        db.query(Report)
        .filter(Report.definition_id == defn.id)
        .order_by(Report.created_at.desc())
        .all()
    )
    return {"items": [serialize_report(r) for r in runs]}


@router.post("/{def_id}/runs")
def create_run(
    def_id: str,
    payload: ReportRunCreate,
    user: User = Depends(require_api_role("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict:
    """Trigger a new run for an existing report definition."""
    defn = _get_def(def_id, user.tenant_id, db)
    artifacts = generate_report(
        db,
        user.tenant_id,
        user.id,
        payload.period_start,
        payload.period_end,
        cadence=defn.cadence,
        title_override=payload.title,
        event_ids=payload.event_ids or None,
        report_type=defn.report_type,
        focal_competitor_id=defn.focal_competitor_id,
        comparison_competitor_ids=defn.comparison_competitor_ids or None,
    )
    artifacts.report.definition_id = defn.id
    db.commit()
    return {"item": serialize_report(artifacts.report)}


@router.get("/{def_id}/runs/{run_id}")
def get_run(
    def_id: str, run_id: str,
    user: User = Depends(get_api_user), db: Session = Depends(get_db),
) -> dict:
    _get_def(def_id, user.tenant_id, db)
    run = _get_run(run_id, user.tenant_id, db)
    events = (
        db.query(Event)
        .join(ReportEvent, ReportEvent.event_id == Event.id)
        .options(joinedload(Event.competitor), joinedload(Event.diff_record))
        .filter(ReportEvent.report_id == run.id)
        .order_by(Event.detected_at.desc())
        .all()
    )
    return {"item": serialize_report(run, events=[serialize_event(e) for e in events])}


@router.post("/{def_id}/runs/{run_id}/publish")
def publish_run(
    def_id: str, run_id: str,
    user: User = Depends(require_api_role("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict:
    _get_def(def_id, user.tenant_id, db)
    run = _get_run(run_id, user.tenant_id, db)
    run.status = "published"
    run.published_by_user_id = user.id
    run.published_at = utcnow()
    db.commit()
    write_notification(
        "report-published",
        {"report_id": run.id, "title": run.title, "published_at": run.published_at.isoformat()},
    )
    return {"item": serialize_report(run)}


@router.post("/{def_id}/runs/{run_id}/send-email")
def send_run_email(
    def_id: str, run_id: str,
    user: User = Depends(require_api_role("admin", "analyst")),
    db: Session = Depends(get_db),
) -> dict:
    from competitor_intel.services.email import send_report_email as _send
    _get_def(def_id, user.tenant_id, db)
    run = _get_run(run_id, user.tenant_id, db)
    sent = _send(f"[RivalPulse] {run.title}", run.executive_summary or "", run.pdf_object_key)
    if not sent:
        raise HTTPException(status_code=400, detail="Email not configured.")
    return {"sent": True}


@router.get("/{def_id}/runs/{run_id}/html")
def download_run_html(
    def_id: str, run_id: str,
    user: User = Depends(get_api_user), db: Session = Depends(get_db),
) -> FileResponse:
    _get_def(def_id, user.tenant_id, db)
    run = _get_run(run_id, user.tenant_id, db)
    if not run.html_object_key:
        raise HTTPException(status_code=404, detail="HTML not found")
    return FileResponse(run.html_object_key, media_type="text/html", filename=f"{run.id}.html")


@router.get("/{def_id}/runs/{run_id}/pdf")
def download_run_pdf(
    def_id: str, run_id: str,
    user: User = Depends(get_api_user), db: Session = Depends(get_db),
) -> FileResponse:
    _get_def(def_id, user.tenant_id, db)
    run = _get_run(run_id, user.tenant_id, db)
    if not run.pdf_object_key:
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(run.pdf_object_key, media_type="application/pdf", filename=f"{run.id}.pdf")
