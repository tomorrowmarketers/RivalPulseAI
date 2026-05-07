from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.orm import Session

from competitor_intel.config import settings
from competitor_intel.models import Competitor, PageSnapshot, Source
from competitor_intel.services.embeddings import embed_query, search_chunks


ASK_PROMPT_VERSION = "ask-rag-v1"
ASK_TOP_K = 8


@dataclass(slots=True)
class AskCitation:
    snapshot_id: str
    source_id: str
    source_url: str
    competitor_name: str | None
    fetched_at: str
    snippet: str
    score: float
    chunk_index: int


@dataclass(slots=True)
class AskAnswer:
    answer: str
    citations: list[AskCitation]
    used_provider: str
    detail: str


def answer_question(
    db: Session,
    tenant_id: str,
    question: str,
    *,
    competitor_ids: list[str] | None = None,
    source_ids: list[str] | None = None,
) -> AskAnswer:
    if not question.strip():
        return AskAnswer(answer="Vui lòng nhập câu hỏi.", citations=[], used_provider="none", detail="empty question")

    if not settings.openai_api_key:
        return AskAnswer(
            answer="Tính năng Ask cần cấu hình OPENAI_API_KEY để gọi mô hình. Hãy bổ sung biến môi trường rồi thử lại.",
            citations=[],
            used_provider="none",
            detail="OPENAI_API_KEY missing",
        )

    try:
        query_emb = embed_query(question)
    except Exception as exc:
        return AskAnswer(
            answer=f"Không tạo được embedding cho câu hỏi: {exc}",
            citations=[],
            used_provider="none",
            detail=str(exc),
        )

    hits = search_chunks(
        db,
        tenant_id=tenant_id,
        query_embedding=query_emb,
        source_ids=source_ids or None,
        competitor_ids=competitor_ids or None,
        top_k=ASK_TOP_K,
    )
    if not hits:
        return AskAnswer(
            answer=(
                "Không tìm thấy nội dung phù hợp trong dữ liệu đã crawl. "
                "Thử mở rộng scope (chọn thêm đối thủ/nguồn) hoặc crawl thêm trước khi hỏi."
            ),
            citations=[],
            used_provider="rag",
            detail="no chunks matched",
        )

    snapshot_ids = list({chunk.snapshot_id for chunk, _ in hits})
    snapshots = {
        snap.id: snap
        for snap in db.query(PageSnapshot).filter(PageSnapshot.id.in_(snapshot_ids)).all()
    }
    source_ids_in_hits = list({snap.source_id for snap in snapshots.values()})
    sources = {
        src.id: src
        for src in db.query(Source).filter(Source.id.in_(source_ids_in_hits)).all()
    }
    competitor_ids_in_hits = list({src.competitor_id for src in sources.values()})
    competitors = {
        comp.id: comp
        for comp in db.query(Competitor).filter(Competitor.id.in_(competitor_ids_in_hits)).all()
    }

    citations: list[AskCitation] = []
    context_parts: list[str] = []
    for idx, (chunk, score) in enumerate(hits, start=1):
        snap = snapshots.get(chunk.snapshot_id)
        if snap is None:
            continue
        src = sources.get(snap.source_id)
        comp = competitors.get(src.competitor_id) if src else None
        snippet = chunk.text[:600]
        citations.append(
            AskCitation(
                snapshot_id=snap.id,
                source_id=snap.source_id,
                source_url=src.url if src else snap.final_url,
                competitor_name=comp.name if comp else None,
                fetched_at=snap.fetched_at.isoformat() if snap.fetched_at else "",
                snippet=snippet,
                score=round(float(score), 4),
                chunk_index=chunk.chunk_index,
            )
        )
        context_parts.append(
            f"[#{idx}] competitor={comp.name if comp else 'n/a'} | "
            f"url={src.url if src else snap.final_url} | "
            f"fetched_at={snap.fetched_at.isoformat() if snap.fetched_at else ''}\n{chunk.text}"
        )

    context = "\n\n---\n\n".join(context_parts)

    try:
        answer_text = _call_chat(question, context)
    except Exception as exc:
        return AskAnswer(
            answer=f"Lỗi khi gọi mô hình: {exc}",
            citations=citations,
            used_provider="rag",
            detail=str(exc),
        )

    return AskAnswer(answer=answer_text, citations=citations, used_provider="openai", detail="ok")


def _call_chat(question: str, context: str) -> str:
    instructions = (
        "You answer questions about competitor websites using ONLY the provided context snippets. "
        "Each snippet is labeled like [#1], [#2], etc. "
        "When you state a fact, cite the snippet number(s) inline like [#1]. "
        "If the context is insufficient, say so plainly. "
        "Reply in the same language the user used (Vietnamese or English). "
        "Be concise: prefer short paragraphs and bullet lists."
    )
    user_input = json.dumps(
        {"question": question, "context": context},
        ensure_ascii=False,
    )
    endpoint = f"{settings.openai_api_base.rstrip('/')}/responses"
    response = httpx.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.openai_ask_model,
            "instructions": instructions,
            "input": user_input,
            "store": False,
        },
        timeout=settings.openai_timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI chat failed: {response.status_code} {response.text[:240]}")
    payload: dict[str, Any] = response.json()
    collected: list[str] = []
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content_item in item.get("content", []):
            if content_item.get("type") == "output_text" and content_item.get("text"):
                collected.append(content_item["text"])
    text = "\n".join(collected).strip()
    if not text:
        raise RuntimeError("OpenAI response did not include output text")
    return text
