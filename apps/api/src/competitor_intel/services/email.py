from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path

from competitor_intel.config import settings

logger = logging.getLogger(__name__)


def send_report_email(subject: str, body_text: str, pdf_path: str | None = None) -> bool:
    """Send a report email with an optional PDF attachment.

    Returns True if sent, False if skipped (email not configured).
    """
    if not settings.email_enabled:
        logger.info("Email delivery disabled (EMAIL_ENABLED=false) — skipping send.")
        return False

    recipients = [r.strip() for r in settings.report_email_recipients.split(",") if r.strip()]
    if not recipients:
        logger.warning("No REPORT_EMAIL_RECIPIENTS configured — skipping email send.")
        return False

    if not settings.smtp_user or not settings.smtp_password:
        logger.warning("SMTP credentials not configured — skipping email send.")
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.email_from
    msg["To"] = ", ".join(recipients)
    msg.set_content(body_text)

    if pdf_path:
        pdf_file = Path(pdf_path)
        if pdf_file.exists():
            with open(pdf_file, "rb") as fh:
                msg.add_attachment(
                    fh.read(),
                    maintype="application",
                    subtype="pdf",
                    filename=pdf_file.name,
                )

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        logger.info("Report email sent to: %s", ", ".join(recipients))
        return True
    except Exception:
        logger.exception("Failed to send report email to %s", ", ".join(recipients))
        return False
