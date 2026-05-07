from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from competitor_intel.api.deps import get_api_user
from competitor_intel.database import get_db
from competitor_intel.models import Competitor, Source, User
from competitor_intel.schemas import AskRequest
from competitor_intel.services.ask import answer_question


router = APIRouter(prefix="/api/ask", tags=["ask"])


@router.get("/scope")
def get_scope(user: User = Depends(get_api_user), db: Session = Depends(get_db)) -> dict:
    """Return competitors and sources the user can scope a question to."""
    competitors = (
        db.query(Competitor)
        .filter(Competitor.tenant_id == user.tenant_id, Competitor.is_active.is_(True))
        .order_by(Competitor.name.asc())
        .all()
    )
    sources = (
        db.query(Source)
        .filter(Source.tenant_id == user.tenant_id, Source.is_active.is_(True))
        .order_by(Source.updated_at.desc())
        .all()
    )
    return {
        "competitors": [
            {"id": c.id, "name": c.name, "primary_domain": c.primary_domain}
            for c in competitors
        ],
        "sources": [
            {
                "id": s.id,
                "competitor_id": s.competitor_id,
                "url": s.url,
                "source_type": s.source_type,
            }
            for s in sources
        ],
    }


@router.post("")
def ask(
    payload: AskRequest,
    user: User = Depends(get_api_user),
    db: Session = Depends(get_db),
) -> dict:
    result = answer_question(
        db,
        tenant_id=user.tenant_id,
        question=payload.question,
        competitor_ids=payload.competitor_ids or None,
        source_ids=payload.source_ids or None,
    )
    return {
        "answer": result.answer,
        "provider": result.used_provider,
        "detail": result.detail,
        "citations": [
            {
                "snapshot_id": c.snapshot_id,
                "source_id": c.source_id,
                "source_url": c.source_url,
                "competitor_name": c.competitor_name,
                "fetched_at": c.fetched_at,
                "snippet": c.snippet,
                "score": c.score,
                "chunk_index": c.chunk_index,
            }
            for c in result.citations
        ],
    }
