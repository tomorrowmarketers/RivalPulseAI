from __future__ import annotations

from competitor_intel.config import settings
from competitor_intel.database import Base, engine, session_scope
from competitor_intel.models import Report, ReportDefinition, Tenant, User, new_id, utcnow
from competitor_intel.seed import seed_default_data
from competitor_intel.storage import ensure_storage_roots


def _migrate_schema() -> None:
    """Add new columns / tables to existing schema (idempotent)."""
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_type VARCHAR(32) DEFAULT 'overview'"
        )
        conn.exec_driver_sql(
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS focal_competitor_id VARCHAR(36) REFERENCES competitors(id) ON DELETE SET NULL"
        )
        # ── Phase 2: report_definitions ─────────────────────────────────────
        conn.exec_driver_sql("""
            CREATE TABLE IF NOT EXISTS report_definitions (
                id VARCHAR(36) PRIMARY KEY,
                tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                report_type VARCHAR(32) NOT NULL DEFAULT 'overview',
                cadence VARCHAR(16) NOT NULL DEFAULT 'biweekly',
                cadence_days INTEGER NOT NULL DEFAULT 14,
                focal_competitor_id VARCHAR(36) REFERENCES competitors(id) ON DELETE SET NULL,
                comparison_competitor_ids JSON DEFAULT '[]',
                auto_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                email_recipients JSON DEFAULT '[]',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.exec_driver_sql(
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS definition_id VARCHAR(36) REFERENCES report_definitions(id) ON DELETE SET NULL"
        )
        # ── Phase 3: discovery seed/link source_type filtering ──────────────
        conn.exec_driver_sql(
            "ALTER TABLE discovery_seeds ADD COLUMN IF NOT EXISTS auto_approve_source_types JSON DEFAULT '[]'"
        )
        conn.exec_driver_sql(
            "ALTER TABLE discovered_links ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) DEFAULT 'other'"
        )


def _migrate_data() -> None:
    """Create default ReportDefinition for each tenant that has reports but no definitions yet."""
    with session_scope() as db:
        tenants_with_orphan_runs = (
            db.query(Report.tenant_id)
            .filter(Report.definition_id.is_(None))
            .distinct()
            .all()
        )
        for (tenant_id,) in tenants_with_orphan_runs:
            # Check if tenant already has a definition
            existing = db.query(ReportDefinition).filter(ReportDefinition.tenant_id == tenant_id).first()
            if existing:
                # Just link orphan runs to it
                db.query(Report).filter(
                    Report.tenant_id == tenant_id,
                    Report.definition_id.is_(None),
                ).update({"definition_id": existing.id})
            else:
                # Create default definition from the oldest run's attributes
                oldest = (
                    db.query(Report)
                    .filter(Report.tenant_id == tenant_id)
                    .order_by(Report.created_at.asc())
                    .first()
                )
                defn = ReportDefinition(
                    id=new_id(),
                    tenant_id=tenant_id,
                    title="Báo cáo tổng quan đối thủ",
                    report_type=getattr(oldest, "report_type", "overview") or "overview",
                    cadence=getattr(oldest, "cadence", "biweekly") or "biweekly",
                    cadence_days=settings.report_cadence_days,
                    auto_enabled=settings.auto_report_enabled,
                    email_enabled=settings.email_enabled,
                    email_recipients=[r.strip() for r in settings.report_email_recipients.split(",") if r.strip()],
                )
                db.add(defn)
                db.flush()
                # Link all orphan runs to this definition
                db.query(Report).filter(
                    Report.tenant_id == tenant_id,
                    Report.definition_id.is_(None),
                ).update({"definition_id": defn.id})
        db.commit()


def bootstrap() -> None:
    ensure_storage_roots()
    if settings.auto_create_schema:
        Base.metadata.create_all(bind=engine)
    _migrate_schema()
    _migrate_data()
    with session_scope() as db:
        if not db.query(Tenant).filter(Tenant.slug == settings.default_tenant_slug).first():
            seed_default_data(db)
