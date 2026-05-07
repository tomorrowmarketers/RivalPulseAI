from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user
from competitor_intel.database import get_db
from competitor_intel.models import User
from competitor_intel.services.system_status import build_system_status


router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/status")
def system_status(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    return build_system_status(db, user.tenant_id)
