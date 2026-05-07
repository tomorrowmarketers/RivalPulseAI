from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "RivalPulse Competitor Intelligence")
    app_env: str = os.getenv("APP_ENV", "development")
    app_host: str = os.getenv("APP_HOST", "0.0.0.0")
    app_port: int = int(os.getenv("API_PORT", os.getenv("APP_PORT", "8410")))
    app_secret_key: str = os.getenv("APP_SECRET_KEY", "change-me")

    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/dev.db")
    auto_create_schema: bool = _as_bool(os.getenv("AUTO_CREATE_SCHEMA"), True)
    storage_root: Path = Path(os.getenv("STORAGE_ROOT", "./data/storage")).resolve()
    reports_root: Path = Path(os.getenv("REPORTS_ROOT", "./data/reports")).resolve()
    outbox_root: Path = Path(os.getenv("OUTBOX_ROOT", "./data/outbox")).resolve()

    crawl_user_agent: str = os.getenv("CRAWL_USER_AGENT", "RivalPulseAI-Competitor-Intel/1.0")
    crawl_timeout_seconds: int = int(os.getenv("CRAWL_TIMEOUT_SECONDS", "25"))
    crawl_poll_interval_seconds: int = int(os.getenv("CRAWL_POLL_INTERVAL_SECONDS", "20"))
    scheduler_interval_seconds: int = int(os.getenv("SCHEDULER_INTERVAL_SECONDS", "60"))
    sync_manual_crawls: bool = _as_bool(os.getenv("SYNC_MANUAL_CRAWLS"), True)
    auto_report_enabled: bool = _as_bool(os.getenv("AUTO_REPORT_ENABLED"), True)
    report_cadence_days: int = int(os.getenv("REPORT_CADENCE_DAYS", "14"))

    # Email delivery
    email_enabled: bool = _as_bool(os.getenv("EMAIL_ENABLED"), False)
    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str | None = os.getenv("SMTP_USER")
    smtp_password: str | None = os.getenv("SMTP_PASSWORD")
    email_from: str = os.getenv("EMAIL_FROM", "reports@rivalpulse.local")
    report_email_recipients: str = os.getenv("REPORT_EMAIL_RECIPIENTS", "")

    ai_provider: str = os.getenv("AI_PROVIDER", "auto")
    ai_fallback_enabled: bool = _as_bool(os.getenv("AI_FALLBACK_ENABLED"), True)
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    openai_api_base: str = os.getenv("OPENAI_API_BASE", "https://api.openai.com/v1")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    openai_ask_model: str = os.getenv("OPENAI_ASK_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o"))
    openai_event_model: str = os.getenv("OPENAI_EVENT_MODEL", "gpt-3.5-turbo")
    openai_report_model: str = os.getenv(
        "OPENAI_REPORT_MODEL",
        os.getenv("OPENAI_ASK_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o")),
    )
    openai_embedding_model: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    openai_timeout_seconds: int = int(os.getenv("OPENAI_TIMEOUT_SECONDS", "40"))

    default_tenant_slug: str = os.getenv("DEFAULT_TENANT_SLUG", "rivalpulse")
    default_admin_email: str = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@rivalpulse.local")
    default_admin_password: str = os.getenv("DEFAULT_ADMIN_PASSWORD", "change-me-local-password")


settings = Settings()
