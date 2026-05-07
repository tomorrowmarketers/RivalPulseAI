from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session, joinedload

from competitor_intel.config import settings
from competitor_intel.models import Event, Report, ReportEvent
from competitor_intel.services.ai import build_report_narrative
from competitor_intel.services.notifications import write_notification
from competitor_intel.storage import write_text


@dataclass(slots=True)
class ReportArtifacts:
    report: Report
    html_path: str
    pdf_path: str


def _date_label(period_start: date, period_end: date) -> str:
    return f"{period_start.isoformat()} to {period_end.isoformat()}"


def _render_report_html(report: Report, events: list[Event]) -> str:
    from collections import defaultdict
    by_competitor: dict[str, list[Event]] = defaultdict(list)
    for event in events:
        by_competitor[event.competitor.name].append(event)

    competitor_sections = ""
    for comp_name, comp_events in sorted(by_competitor.items()):
        rows = "\n".join(
            f"<tr><td>{e.title}</td><td>{e.event_type.replace('_', ' ').title()}</td>"
            f"<td class='urgency-{e.urgency}'>{e.urgency.upper()}</td>"
            f"<td>{e.summary}</td>"
            f"<td><a href='{e.source_url}' target='_blank'>Source ↗</a></td></tr>"
            for e in comp_events
        )
        competitor_sections += f"""
        <h3 class="comp-heading">{comp_name} <span class="count">({len(comp_events)} change{'s' if len(comp_events) != 1 else ''})</span></h3>
        <table>
          <thead><tr><th>Change</th><th>Category</th><th>Priority</th><th>Summary</th><th>URL</th></tr></thead>
          <tbody>{rows}</tbody>
        </table>
        """

    return f"""
    <html>
      <head>
        <meta charset="utf-8" />
        <title>{report.title}</title>
        <style>
          body {{ font-family: Arial, sans-serif; padding: 32px; color: #1c1c1c; max-width: 960px; margin: 0 auto; }}
          h1 {{ font-size: 22px; margin-bottom: 4px; }}
          h2 {{ font-size: 16px; margin-top: 28px; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }}
          h3.comp-heading {{ font-size: 14px; margin-top: 20px; margin-bottom: 6px; color: #111; }}
          .count {{ font-weight: normal; color: #6b7280; font-size: 12px; }}
          table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }}
          td, th {{ border: 1px solid #e5e7eb; padding: 7px 10px; vertical-align: top; text-align: left; }}
          th {{ background: #f9fafb; font-weight: 600; }}
          .muted {{ color: #6b7280; font-size: 13px; }}
          .urgency-high {{ color: #dc2626; font-weight: 600; }}
          .urgency-medium {{ color: #d97706; }}
          .urgency-low {{ color: #6b7280; }}
          a {{ color: #2563eb; }}
        </style>
      </head>
      <body>
        <h1>{report.title}</h1>
        <p class="muted">Period: {_date_label(report.period_start, report.period_end)} &nbsp;·&nbsp; Generated: {report.generated_at.strftime('%B %d, %Y') if report.generated_at else ''}</p>
        <h2>Executive Summary</h2>
        <p>{report.executive_summary or ''}</p>
        <h2>Cross-Market Patterns</h2>
        <p>{report.cross_market_patterns or ''}</p>
        <h2>Recommended Actions</h2>
        <p>{report.recommended_actions or ''}</p>
        <h2>Changes by Competitor</h2>
        {competitor_sections if competitor_sections else '<p class="muted">No changes detected in this period.</p>'}
      </body>
    </html>
    """


def _render_report_pdf(path: Path, report: Report, events: list[Event]) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4
    y = height - 20 * mm
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20 * mm, y, report.title)
    y -= 10 * mm
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, y, f"Period: {_date_label(report.period_start, report.period_end)}")
    y -= 10 * mm
    for section_title, body in [
        ("Executive Summary", report.executive_summary or ""),
        ("Cross-Market Patterns", report.cross_market_patterns or ""),
        ("Recommended Actions", report.recommended_actions or ""),
    ]:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(20 * mm, y, section_title)
        y -= 6 * mm
        c.setFont("Helvetica", 10)
        for line in _split_lines(body, 95):
            if y < 20 * mm:
                c.showPage()
                y = height - 20 * mm
            c.drawString(20 * mm, y, line)
            y -= 5 * mm
        y -= 4 * mm
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20 * mm, y, "Reviewed Events")
    y -= 6 * mm
    c.setFont("Helvetica", 9)
    for event in events:
        for line in _split_lines(f"- {event.competitor.name} | {event.event_type} | {event.summary}", 100):
            if y < 15 * mm:
                c.showPage()
                y = height - 20 * mm
            c.drawString(15 * mm, y, line)
            y -= 4.5 * mm
    c.save()


def _split_lines(value: str, limit: int) -> list[str]:
    words = value.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) > limit:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [""]


def generate_report(
    db: Session,
    tenant_id: str,
    user_id: str | None,
    period_start: date,
    period_end: date,
    cadence: str = "biweekly",
    title_override: str | None = None,
    event_ids: list[str] | None = None,
    approved_only: bool = False,
    report_type: str = "overview",
    focal_competitor_id: str | None = None,
    comparison_competitor_ids: list[str] | None = None,
) -> ReportArtifacts:
    # Resolve focal competitor name for prompts
    focal_competitor = None
    comparison_competitors: list = []
    if focal_competitor_id:
        from competitor_intel.models import Competitor
        focal_competitor = db.query(Competitor).filter(Competitor.id == focal_competitor_id, Competitor.tenant_id == tenant_id).first()
    if comparison_competitor_ids:
        from competitor_intel.models import Competitor
        comparison_competitors = db.query(Competitor).filter(Competitor.id.in_(comparison_competitor_ids), Competitor.tenant_id == tenant_id).all()

    # By default include all non-dismissed events (approved + pending).
    # Pass approved_only=True to restrict to manually approved events only.
    status_filter = (Event.review_status == "approved") if approved_only else (Event.review_status != "dismissed")
    query = (
        db.query(Event)
        .options(joinedload(Event.competitor))
        .filter(
            Event.tenant_id == tenant_id,
            status_filter,
            Event.detected_at >= datetime.combine(period_start, datetime.min.time(), tzinfo=UTC),
            Event.detected_at <= datetime.combine(period_end, datetime.max.time(), tzinfo=UTC),
        )
    )
    if event_ids:
        query = query.filter(Event.id.in_(event_ids))

    # For single_domain: filter to only the focal competitor's events
    # For comparison: include focal + comparison competitors only
    if report_type == "single_domain" and focal_competitor_id:
        query = query.filter(Event.competitor_id == focal_competitor_id)
    elif report_type == "comparison" and focal_competitor_id:
        all_ids = [focal_competitor_id] + (comparison_competitor_ids or [])
        query = query.filter(Event.competitor_id.in_(all_ids))

    events = query.order_by(Event.detected_at.desc()).all()

    narrative = build_report_narrative(
        events,
        period_start,
        period_end,
        report_type=report_type,
        focal_competitor=focal_competitor,
        comparison_competitors=comparison_competitors,
    )
    title = title_override.strip() if title_override and title_override.strip() else f"Competitor Intelligence Report - {_date_label(period_start, period_end)}"

    report = Report(
        tenant_id=tenant_id,
        title=title,
        period_start=period_start,
        period_end=period_end,
        cadence=cadence,
        report_type=report_type,
        focal_competitor_id=focal_competitor_id,
        status="draft",
        generated_by_user_id=user_id,
        executive_summary=narrative.executive_summary,
        cross_market_patterns=narrative.cross_market_patterns,
        recommended_actions=narrative.recommended_actions,
        generated_at=datetime.now(UTC),
    )
    db.add(report)
    db.flush()

    for order, event in enumerate(events):
        db.add(ReportEvent(report_id=report.id, event_id=event.id, section="key_changes", sort_order=order))

    html_body = _render_report_html(report, events)
    html_path = write_text(f"{report.id}/report.html", html_body, root=settings.reports_root)
    pdf_path = str(settings.reports_root / report.id / "report.pdf")
    Path(pdf_path).parent.mkdir(parents=True, exist_ok=True)
    _render_report_pdf(Path(pdf_path), report, events)

    report.html_object_key = html_path
    report.pdf_object_key = pdf_path
    report.key_changes_json = [
        {
            "competitor": event.competitor.name,
            "title": event.title,
            "event_type": event.event_type,
            "urgency": event.urgency,
            "url": event.source_url,
        }
        for event in events[:20]
    ]
    db.flush()

    write_notification(
        "reports",
        {
            "report_id": report.id,
            "title": report.title,
            "status": report.status,
            "generated_at": report.generated_at.isoformat() if report.generated_at else None,
        },
    )
    return ReportArtifacts(report=report, html_path=html_path, pdf_path=pdf_path)
