from __future__ import annotations

import math
from typing import Iterable

import httpx
from sqlalchemy.orm import Session

from competitor_intel.config import settings
from competitor_intel.models import PageSnapshot, SnapshotChunk


EMBEDDING_MODEL = settings.openai_embedding_model
MAX_CHUNK_CHARS = 1200
MIN_CHUNK_CHARS = 40


def _chunkify(blocks: list[str]) -> list[str]:
    """Group small blocks together so each chunk is meaningful (~1200 chars)."""
    chunks: list[str] = []
    buffer: list[str] = []
    buffer_len = 0
    for block in blocks:
        block = (block or "").strip()
        if not block:
            continue
        if len(block) >= MAX_CHUNK_CHARS:
            if buffer:
                chunks.append("\n\n".join(buffer))
                buffer, buffer_len = [], 0
            # Split very large blocks
            for i in range(0, len(block), MAX_CHUNK_CHARS):
                chunks.append(block[i : i + MAX_CHUNK_CHARS])
            continue
        if buffer_len + len(block) + 2 > MAX_CHUNK_CHARS:
            chunks.append("\n\n".join(buffer))
            buffer, buffer_len = [block], len(block)
        else:
            buffer.append(block)
            buffer_len += len(block) + 2
    if buffer:
        joined = "\n\n".join(buffer)
        if len(joined) >= MIN_CHUNK_CHARS or not chunks:
            chunks.append(joined)
    return chunks


def _embed_batch(texts: list[str]) -> list[list[float]]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    endpoint = f"{settings.openai_api_base.rstrip('/')}/embeddings"
    response = httpx.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        json={"model": EMBEDDING_MODEL, "input": texts},
        timeout=settings.openai_timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI embeddings failed: {response.status_code} {response.text[:240]}")
    payload = response.json()
    return [item["embedding"] for item in payload.get("data", [])]


def index_snapshot(db: Session, snapshot: PageSnapshot) -> int:
    """Embed a snapshot's content into SnapshotChunk rows. Returns chunk count.

    Idempotent: if chunks already exist for this snapshot_id, returns 0.
    Dedup: if a previous snapshot with the same content_hash already has chunks,
    copy those embeddings instead of re-calling the API.
    """
    existing = db.query(SnapshotChunk).filter(SnapshotChunk.snapshot_id == snapshot.id).count()
    if existing > 0:
        return 0

    blocks = list(snapshot.extracted_blocks or [])
    if snapshot.page_title:
        blocks.insert(0, f"Page title: {snapshot.page_title}")
    if snapshot.h1:
        blocks.insert(1 if snapshot.page_title else 0, f"H1: {snapshot.h1}")
    if snapshot.meta_description:
        blocks.insert(0, f"Meta: {snapshot.meta_description}")

    chunks = _chunkify(blocks)
    if not chunks:
        return 0

    # Try to reuse embeddings from a prior snapshot with same content_hash
    twin_chunks = (
        db.query(SnapshotChunk)
        .filter(
            SnapshotChunk.source_id == snapshot.source_id,
            SnapshotChunk.content_hash == snapshot.content_hash,
            SnapshotChunk.snapshot_id != snapshot.id,
        )
        .order_by(SnapshotChunk.chunk_index.asc())
        .all()
    )
    if twin_chunks and len(twin_chunks) == len(chunks):
        for idx, twin in enumerate(twin_chunks):
            db.add(
                SnapshotChunk(
                    tenant_id=snapshot.tenant_id,
                    source_id=snapshot.source_id,
                    snapshot_id=snapshot.id,
                    chunk_index=idx,
                    text=twin.text,
                    embedding=twin.embedding,
                    embedding_model=twin.embedding_model,
                    content_hash=snapshot.content_hash,
                )
            )
        db.flush()
        return len(twin_chunks)

    if not settings.openai_api_key:
        # Store text without embeddings; ask layer will skip if no embeddings
        for idx, text in enumerate(chunks):
            db.add(
                SnapshotChunk(
                    tenant_id=snapshot.tenant_id,
                    source_id=snapshot.source_id,
                    snapshot_id=snapshot.id,
                    chunk_index=idx,
                    text=text,
                    embedding=[],
                    embedding_model=None,
                    content_hash=snapshot.content_hash,
                )
            )
        db.flush()
        return len(chunks)

    # Batch embed (OpenAI accepts up to 2048 inputs per request, we cap at 64)
    BATCH = 64
    embeddings: list[list[float]] = []
    for i in range(0, len(chunks), BATCH):
        embeddings.extend(_embed_batch(chunks[i : i + BATCH]))

    for idx, (text, emb) in enumerate(zip(chunks, embeddings)):
        db.add(
            SnapshotChunk(
                tenant_id=snapshot.tenant_id,
                source_id=snapshot.source_id,
                snapshot_id=snapshot.id,
                chunk_index=idx,
                text=text,
                embedding=emb,
                embedding_model=EMBEDDING_MODEL,
                content_hash=snapshot.content_hash,
            )
        )
    db.flush()
    return len(chunks)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    denom = math.sqrt(na) * math.sqrt(nb)
    return dot / denom if denom else 0.0


def embed_query(text: str) -> list[float]:
    return _embed_batch([text])[0]


def search_chunks(
    db: Session,
    tenant_id: str,
    query_embedding: list[float],
    *,
    source_ids: Iterable[str] | None = None,
    competitor_ids: Iterable[str] | None = None,
    top_k: int = 8,
) -> list[tuple[SnapshotChunk, float]]:
    from competitor_intel.models import Source as _Source

    query = db.query(SnapshotChunk).filter(SnapshotChunk.tenant_id == tenant_id)
    if source_ids:
        query = query.filter(SnapshotChunk.source_id.in_(list(source_ids)))
    elif competitor_ids:
        ids = [
            row.id
            for row in db.query(_Source.id).filter(
                _Source.tenant_id == tenant_id,
                _Source.competitor_id.in_(list(competitor_ids)),
            )
        ]
        if not ids:
            return []
        query = query.filter(SnapshotChunk.source_id.in_(ids))

    candidates = query.all()
    scored: list[tuple[SnapshotChunk, float]] = []
    for chunk in candidates:
        if not chunk.embedding:
            continue
        score = cosine_similarity(query_embedding, list(chunk.embedding))
        if score > 0:
            scored.append((chunk, score))
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:top_k]
