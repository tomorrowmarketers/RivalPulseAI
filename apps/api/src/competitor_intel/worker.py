from __future__ import annotations

import logging
import sys
import time
from datetime import date

from competitor_intel.bootstrap import bootstrap
from competitor_intel.config import settings
from competitor_intel.database import session_scope
from competitor_intel.models import Report, ReportDefinition, Tenant, User
from competitor_intel.services.email import send_report_email
from competitor_intel.services.link_discovery import rescan_due_seeds
from competitor_intel.services.pipeline import enqueue_due_sources, process_next_crawl_job
from competitor_intel.services.reports import generate_report, next_report_window

logger = logging.getLogger(__name__)


def _report_email_payload(title: str, start: date, end: date, event_count: int, summary: str | None) -> tuple[str, str]:
    subject = f"[RivalPulse] {title}"
    body = (
        f"Your scheduled competitor intelligence report is ready.\n\n"
        f"Period: {start.isoformat()} to {end.isoformat()}\n"
        f"Events captured: {event_count}\n\n"
        f"Executive Summary:\n{summary or 'See attached PDF.'}\n\n"
        f"The full report is attached as a PDF."
    )
    return subject, body


def _latest_report_query(db, tenant_id: str, definition_id: str | None):
    query = db.query(Report).filter(Report.tenant_id == tenant_id)
    if definition_id is None:
        query = query.filter(Report.definition_id.is_(None))
    else:
        query = query.filter(Report.definition_id == definition_id)
    return query.order_by(Report.period_end.desc(), Report.created_at.desc())


def maybe_generate_recurring_report() -> None:
    if not settings.auto_report_enabled:
        return

    today = date.today()
    pending_emails: list[tuple[str, str, str | None, str]] = []
    with session_scope() as db:
        tenants = db.query(Tenant).all()
        for tenant in tenants:
            admin = db.query(User).filter(User.tenant_id == tenant.id, User.role == "admin").first()
            definitions = (
                db.query(ReportDefinition)
                .filter(ReportDefinition.tenant_id == tenant.id, ReportDefinition.is_active.is_(True))
                .all()
            )
            auto_definitions = [definition for definition in definitions if definition.auto_enabled]

            if auto_definitions:
                for definition in auto_definitions:
                    last_report = _latest_report_query(db, tenant.id, definition.id).first()
                    window = next_report_window(last_report, definition.cadence_days, today=today)
                    if not window["is_due"]:
                        continue
                    start = window["period_start"]
                    end = window["period_end"]
                    existing = (
                        db.query(Report)
                        .filter(
                            Report.tenant_id == tenant.id,
                            Report.definition_id == definition.id,
                            Report.period_start == start,
                            Report.period_end == end,
                        )
                        .first()
                    )
                    if existing is not None:
                        continue

                    title = f"{definition.title} - {start.isoformat()} to {end.isoformat()}"
                    logger.info("Auto-generating report definition %s for %s -> %s", definition.id, start, end)
                    artifacts = generate_report(
                        db,
                        tenant.id,
                        admin.id if admin else None,
                        start,
                        end,
                        cadence=definition.cadence,
                        title_override=title,
                        report_type=definition.report_type,
                        focal_competitor_id=definition.focal_competitor_id,
                        comparison_competitor_ids=definition.comparison_competitor_ids or None,
                    )
                    artifacts.report.definition_id = definition.id
                    db.flush()
                    if definition.email_enabled:
                        subject, body = _report_email_payload(
                            artifacts.report.title,
                            start,
                            end,
                            len(artifacts.report.key_changes_json or []),
                            artifacts.report.executive_summary,
                        )
                        pending_emails.append((subject, body, artifacts.pdf_path, artifacts.report.id))
                continue

            if definitions:
                continue

            cadence_days = settings.report_cadence_days
            last_report = _latest_report_query(db, tenant.id, None).first()
            window = next_report_window(last_report, cadence_days, today=today)
            if not window["is_due"]:
                continue
            start = window["period_start"]
            end = window["period_end"]
            existing = (
                db.query(Report)
                .filter(Report.tenant_id == tenant.id, Report.period_start == start, Report.period_end == end)
                .first()
            )
            if existing is not None:
                continue

            logger.info("Auto-generating fallback recurring report for %s -> %s", start, end)
            artifacts = generate_report(db, tenant.id, admin.id if admin else None, start, end, cadence="biweekly")
            db.flush()
            subject, body = _report_email_payload(
                artifacts.report.title,
                start,
                end,
                len(artifacts.report.key_changes_json or []),
                artifacts.report.executive_summary,
            )
            pending_emails.append((subject, body, artifacts.pdf_path, artifacts.report.id))

    for subject, body, pdf_path, report_id in pending_emails:
        sent = send_report_email(subject, body, pdf_path)
        if sent:
            logger.info("Recurring report emailed successfully (report_id=%s)", report_id)


def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
        stream=sys.stdout,
        force=True,
    )
    bootstrap()
    last_scheduler_run = 0.0
    while True:
        now = time.time()
        if now - last_scheduler_run >= settings.scheduler_interval_seconds:
            with session_scope() as db:
                enqueue_due_sources(db)
            with session_scope() as db:
                rescan_due_seeds(db)
            maybe_generate_recurring_report()
            last_scheduler_run = now
        try:
            with session_scope() as db:
                process_next_crawl_job(db)
        except Exception as exc:
            logger.exception("Unexpected error processing crawl job: %s", exc)
        time.sleep(settings.crawl_poll_interval_seconds)


if __name__ == "__main__":
    run()
