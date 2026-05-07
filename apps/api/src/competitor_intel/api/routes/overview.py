from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user
from competitor_intel.database import get_db
from competitor_intel.models import User
from competitor_intel.services.dashboard import build_dashboard_data


router = APIRouter(prefix="/api/overview", tags=["overview"])


@router.get("")
def overview(days: int = 14, user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    return build_dashboard_data(db, user.tenant_id, days)
