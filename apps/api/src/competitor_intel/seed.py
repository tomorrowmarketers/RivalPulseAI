from __future__ import annotations

from sqlalchemy.orm import Session

from competitor_intel.config import settings
from competitor_intel.models import Tenant, User
from competitor_intel.security import hash_password


def seed_default_data(db: Session) -> None:
    tenant = db.query(Tenant).filter(Tenant.slug == settings.default_tenant_slug).first()
    if tenant is None:
        tenant = Tenant(name="RivalPulse", slug=settings.default_tenant_slug)
        db.add(tenant)
        db.flush()

    existing_admin = db.query(User).filter(User.tenant_id == tenant.id, User.email == settings.default_admin_email).first()
    if existing_admin is None:
        db.add(
            User(
                tenant_id=tenant.id,
                email=settings.default_admin_email,
                full_name="RivalPulse Admin",
                role="admin",
                password_hash=hash_password(settings.default_admin_password),
            )
        )
        db.flush()
