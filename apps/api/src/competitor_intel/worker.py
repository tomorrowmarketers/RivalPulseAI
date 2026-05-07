from __future__ import annotations

import logging
import time
from datetime import date, timedelta

from competitor_intel.bootstrap import bootstrap
from competitor_intel.config import settings
from competitor_intel.database import session_scope
from competitor_intel.models import Report, Tenant, User
from competitor_intel.services.email import send_report_email
from competitor_intel.services.link_discovery import rescan_due_seeds
from competitor_intel.services.pipeline import enqueue_due_sources, process_next_crawl_job
from competitor_intel.services.reports import generate_report

logger = logging.getLogger(__name__)


def maybe_generate_recurring_report() -> None:
    if not settings.auto_report_enabled:
        return
    with session_scope() as db:
        tenant = db.query(Tenant).first()
        if tenant is None:
            return
        admin = db.query(User).filter(User.tenant_id == tenant.id, User.role == "admin").first()

        cadence_days = settings.report_cadence_days
        end = date.today()
        start = end - timedelta(days=cadence_days - 1)

        existing = (
            db.query(Report)
            .filter(Report.tenant_id == tenant.id, Report.period_start == start, Report.period_end == end)
            .first()
        )
        if existing is not None:
            return

        logger.info("Auto-generating recurring report for %s → %s", start, end)
        artifacts = generate_report(db, tenant.id, admin.id if admin else None, start, end, cadence="biweekly")
        db.commit()

        subject = f"[RivalPulse] {artifacts.report.title}"
        body = (
            f"Your scheduled competitor intelligence report is ready.\n\n"
            f"Period: {start.isoformat()} to {end.isoformat()}\n"
            f"Events captured: {len(artifacts.report.key_changes_json)}\n\n"
            f"Executive Summary:\n{artifacts.report.executive_summary or 'See attached PDF.'}\n\n"
            f"The full report is attached as a PDF."
        )
        sent = send_report_email(subject, body, artifacts.pdf_path)
        if sent:
            logger.info("Recurring report emailed successfully (report_id=%s)", artifacts.report.id)


def run() -> None:
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
        with session_scope() as db:
            process_next_crawl_job(db)
        time.sleep(settings.crawl_poll_interval_seconds)


if __name__ == "__main__":
    run()
