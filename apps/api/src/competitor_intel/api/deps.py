from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from competitor_intel.database import get_db
from competitor_intel.models import User


def get_api_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    tenant_id = request.session.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    user = db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id, User.is_active.is_(True)).first()
    if user is None:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    return user


def require_api_role(*allowed_roles: str):
    def dependency(user: User = Depends(get_api_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
        return user

    return dependency
