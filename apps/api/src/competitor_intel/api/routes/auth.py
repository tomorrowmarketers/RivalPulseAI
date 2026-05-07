from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user
from competitor_intel.api.serializers import serialize_user
from competitor_intel.database import get_db
from competitor_intel.models import User
from competitor_intel.schemas import LoginRequest
from competitor_intel.security import verify_password


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> dict:
    user = db.query(User).filter(User.email == payload.email, User.is_active.is_(True)).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    request.session["user_id"] = user.id
    request.session["tenant_id"] = user.tenant_id
    return {"user": serialize_user(user)}


@router.post("/logout")
def logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_api_user)) -> dict:
    return {"user": serialize_user(user)}
