from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.orm import Session

from competitor_intel.config import settings
from competitor_intel.models import Competitor, DiffRecord, Event, PageSnapshot, Source


@dataclass(slots=True)
class AdhocReportResult:
    title: str
    answer: str
    period_start: str
    period_end: str
    sources_used: list[dict[str, Any]]
    competitors_used: list[dict[str, Any]]
    event_count: int
    diff_count: int
    provider: str
    detail: str


def build_adhoc_report(
    db: Session,
    tenant_id: str,
    *,
    question: str,
    competitor_ids: list[str] | None,
    source_ids: list[str] | None,
    days: int,
    title: str | None,
) -> AdhocReportResult:
    period_end = datetime.now(UTC)
    period_start = period_end - timedelta(days=max(1, days))

    src_query = db.query(Source).filter(Source.tenant_id == tenant_id, Source.is_active.is_(True))
    if source_ids:
        src_query = src_query.filter(Source.id.in_(source_ids))
    elif competitor_ids:
        src_query = src_query.filter(Source.competitor_id.in_(competitor_ids))
    sources = src_query.all()
    sources_by_id = {s.id: s for s in sources}

    if not sources:
        return AdhocReportResult(
            title=title or "Báo cáo tuỳ chỉnh",
            answer="Không có nguồn nào trong scope đã chọn. Hãy tick ít nhất 1 đối thủ hoặc nguồn.",
            period_start=period_start.isoformat(),
            period_end=period_end.isoformat(),
            sources_used=[],
            competitors_used=[],
            event_count=0,
            diff_count=0,
            provider="none",
            detail="empty scope",
        )

    competitor_id_set = {s.competitor_id for s in sources}
    competitors = (
        db.query(Competitor)
        .filter(Competitor.id.in_(competitor_id_set))
        .all()
    )
    competitors_by_id = {c.id: c for c in competitors}

    diffs = (
        db.query(DiffRecord)
        .filter(
            DiffRecord.tenant_id == tenant_id,
            DiffRecord.source_id.in_(sources_by_id.keys()),
            DiffRecord.created_at >= period_start,
            DiffRecord.diff_status == "detected",
        )
        .order_by(DiffRecord.created_at.desc())
        .limit(60)
        .all()
    )

    events = (
        db.query(Event)
        .filter(
            Event.tenant_id == tenant_id,
            Event.source_id.in_(sources_by_id.keys()),
            Event.detected_at >= period_start,
        )
        .order_by(Event.detected_at.desc())
        .limit(60)
        .all()
    )

    snapshot_id_set = {d.current_snapshot_id for d in diffs}
    snapshots = {
        s.id: s
        for s in db.query(PageSnapshot).filter(PageSnapshot.id.in_(snapshot_id_set)).all()
    } if snapshot_id_set else {}

    diff_payload = []
    for d in diffs[:30]:
        snap = snapshots.get(d.current_snapshot_id)
        src = sources_by_id.get(d.source_id)
        comp = competitors_by_id.get(src.competitor_id) if src else None
        diff_payload.append(
            {
                "competitor": comp.name if comp else "n/a",
                "source_url": src.url if src else "",
                "source_type": src.source_type if src else "",
                "fetched_at": snap.fetched_at.isoformat() if snap and snap.fetched_at else "",
                "added": (d.added_blocks or [])[:8],
                "removed": (d.removed_blocks or [])[:8],
                "headings": (d.changed_headings or [])[:5],
                "ctas": (d.changed_ctas or [])[:5],
                "entities": d.extracted_entities or {},
            }
        )

    event_payload = [
        {
            "competitor": competitors_by_id.get(e.competitor_id).name if competitors_by_id.get(e.competitor_id) else "n/a",
            "event_type": e.event_type,
            "title": e.title,
            "summary": e.summary,
            "urgency": e.urgency,
            "review_status": e.review_status,
            "detected_at": e.detected_at.isoformat() if e.detected_at else "",
            "source_url": e.source_url,
        }
        for e in events[:30]
    ]

    final_title = title or f"Báo cáo tuỳ chỉnh — {period_start.date().isoformat()} → {period_end.date().isoformat()}"

    if not settings.openai_api_key:
        return AdhocReportResult(
            title=final_title,
            answer=_heuristic_summary(question, diff_payload, event_payload),
            period_start=period_start.isoformat(),
            period_end=period_end.isoformat(),
            sources_used=[
                {"id": s.id, "url": s.url, "source_type": s.source_type, "competitor_id": s.competitor_id}
                for s in sources
            ],
            competitors_used=[{"id": c.id, "name": c.name} for c in competitors],
            event_count=len(events),
            diff_count=len(diffs),
            provider="heuristic",
            detail="OPENAI_API_KEY missing — fallback summary",
        )

    try:
        answer = _call_synthesis(question, diff_payload, event_payload, period_start, period_end)
        provider = "openai"
        detail = "ok"
    except Exception as exc:
        answer = _heuristic_summary(question, diff_payload, event_payload)
        provider = "heuristic"
        detail = f"OpenAI failed: {exc}"

    return AdhocReportResult(
        title=final_title,
        answer=answer,
        period_start=period_start.isoformat(),
        period_end=period_end.isoformat(),
        sources_used=[
            {"id": s.id, "url": s.url, "source_type": s.source_type, "competitor_id": s.competitor_id}
            for s in sources
        ],
        competitors_used=[{"id": c.id, "name": c.name} for c in competitors],
        event_count=len(events),
        diff_count=len(diffs),
        provider=provider,
        detail=detail,
    )


def _heuristic_summary(question: str, diffs: list[dict], events: list[dict]) -> str:
    lines = [f"# Tổng hợp\n\n_Yêu cầu:_ {question}\n"]
    if events:
        lines.append(f"## Sự kiện đã phát hiện ({len(events)})")
        for e in events[:10]:
            lines.append(f"- **{e['competitor']}** — {e['title']} _({e['event_type']}, urgency: {e['urgency']})_")
        lines.append("")
    if diffs:
        lines.append(f"## Thay đổi nội dung ({len(diffs)} bản ghi)")
        for d in diffs[:8]:
            added = len(d.get("added") or [])
            removed = len(d.get("removed") or [])
            lines.append(f"- **{d['competitor']}** — `{d['source_type']}`: +{added} / −{removed} block · {d['fetched_at'][:10]}")
        lines.append("")
    if not events and not diffs:
        lines.append("_Không có thay đổi nào trong khoảng thời gian được chọn._")
    return "\n".join(lines)


def _call_synthesis(
    question: str,
    diffs: list[dict],
    events: list[dict],
    period_start: datetime,
    period_end: datetime,
) -> str:
    instructions = (
        "Bạn là chuyên gia phân tích tình báo cạnh tranh, đang trả lời câu hỏi nội bộ từ đội thương mại. "
        "Dữ liệu gồm các thay đổi nội dung (diffs) và sự kiện cạnh tranh đã thu thập thực tế. "
        "VIẾT HOÀN TOÀN BẰNG TIẾNG VIỆT.\n\n"
        "QUY TẮC:\n"
        "- Chỉ sử dụng thông tin từ diffs và events được cung cấp, KHÔNG suy đoán ngoài phạm vi dữ liệu.\n"
        "- Trích dẫn tên đối thủ và URL nguồn cụ thể để tăng độ tin cậy.\n"
        "- Nếu dữ liệu không đủ để trả lời một phần, hãy nói rõ phần nào thiếu dữ liệu.\n"
        "- Output dạng Markdown, rõ ràng, dễ đọc, dùng heading và bullet.\n\n"
        "CẤU TRÚC BÁO CÁO (theo đúng thứ tự này):\n\n"
        "## Trả lời trực tiếp\n"
        "Trả lời câu hỏi của người dùng ngay trong 2–4 câu, súc tích và thực chất. "
        "Nếu câu hỏi yêu cầu liệt kê, hãy tóm tắt nhanh rồi đi vào chi tiết ở phần sau.\n\n"
        "## Bằng chứng chi tiết\n"
        "Liệt kê các sự kiện và thay đổi liên quan, mỗi item theo format:\n"
        "**[Tên đối thủ]** — [Mô tả thay đổi cụ thể] *(loại: ..., mức độ: ...)*\n"
        "> Trích dẫn bằng chứng từ dữ liệu nếu có. Ghi rõ nguồn URL.\n\n"
        "## Phân tích & Ý nghĩa kinh doanh\n"
        "Giải thích ý nghĩa của các thay đổi này:\n"
        "- Tại sao đây là tín hiệu quan trọng?\n"
        "- Ai trong tổ chức của bạn bị ảnh hưởng và như thế nào?\n"
        "- Xu hướng gì đang hình thành nếu nhìn tổng thể nhiều thay đổi?\n\n"
        "## Khuyến nghị hành động\n"
        "2–4 hành động cụ thể, ưu tiên theo mức độ cấp thiết. "
        "Mỗi hành động ghi rõ: bộ phận thực hiện + hành động cần làm + kết quả kỳ vọng hoặc rủi ro nếu không làm."
    )
    user_input = json.dumps(
        {
            "question": question,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "diffs": diffs,
            "events": events,
        },
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
            "model": settings.openai_report_model,
            "instructions": instructions,
            "input": user_input,
            "store": False,
        },
        timeout=settings.openai_timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI request failed: {response.status_code} {response.text[:240]}")
    payload = response.json()
    collected: list[str] = []
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content_item in item.get("content", []):
            if content_item.get("type") == "output_text" and content_item.get("text"):
                collected.append(content_item["text"])
    text = "\n".join(collected).strip()
    if not text:
        raise RuntimeError("Empty OpenAI response")
    return text
