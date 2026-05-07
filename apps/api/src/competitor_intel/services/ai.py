from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

from competitor_intel.config import settings
from competitor_intel.constants import EVENT_TYPES
from competitor_intel.models import Competitor, DiffRecord, Event, Source
from competitor_intel.services.classifier import ClassifiedEvent, HEURISTIC_PROMPT_VERSION, classify_diff


OPENAI_PROMPT_VERSION = "openai-responses-v1"
URGENCY_LEVELS = ["low", "medium", "high"]


@dataclass(slots=True)
class AIRuntimeStatus:
    requested_mode: str
    active_mode: str
    uses_live_gpt: bool
    ready: bool
    fallback_active: bool
    model: str | None
    detail: str


@dataclass(slots=True)
class AIClassificationBatch:
    events: list[ClassifiedEvent]
    provider: str
    prompt_version: str
    status_detail: str


@dataclass(slots=True)
class ReportNarrative:
    executive_summary: str
    cross_market_patterns: str
    recommended_actions: str
    provider: str
    prompt_version: str
    status_detail: str


def get_ai_runtime_status() -> AIRuntimeStatus:
    requested_mode = settings.ai_provider.strip().lower() or "auto"
    if requested_mode not in {"auto", "openai", "heuristic"}:
        requested_mode = "auto"

    if requested_mode == "heuristic":
        return AIRuntimeStatus(
            requested_mode=requested_mode,
            active_mode="heuristic",
            uses_live_gpt=False,
            ready=True,
            fallback_active=False,
            model=None,
            detail="Heuristic mode forced by configuration.",
        )

    if settings.openai_api_key:
        return AIRuntimeStatus(
            requested_mode=requested_mode,
            active_mode="openai",
            uses_live_gpt=True,
            ready=True,
            fallback_active=False,
            model=settings.openai_event_model,
            detail="OpenAI Responses API is configured for live event extraction and report synthesis.",
        )

    if requested_mode == "openai" and not settings.ai_fallback_enabled:
        return AIRuntimeStatus(
            requested_mode=requested_mode,
            active_mode="openai",
            uses_live_gpt=False,
            ready=False,
            fallback_active=False,
            model=settings.openai_event_model,
            detail="OPENAI_API_KEY is missing and heuristic fallback is disabled.",
        )

    return AIRuntimeStatus(
        requested_mode=requested_mode,
        active_mode="heuristic",
        uses_live_gpt=False,
        ready=True,
        fallback_active=True,
        model=None,
        detail="OPENAI_API_KEY is missing, so the system is using heuristic fallback.",
    )


def serialize_ai_status() -> dict[str, Any]:
    status = get_ai_runtime_status()
    return {
        "requested_mode": status.requested_mode,
        "active_mode": status.active_mode,
        "uses_live_gpt": status.uses_live_gpt,
        "ready": status.ready,
        "fallback_active": status.fallback_active,
        "model": status.model,
        "detail": status.detail,
    }


def classify_market_change(competitor: Competitor, source: Source, diff: DiffRecord) -> AIClassificationBatch:
    status = get_ai_runtime_status()
    if status.uses_live_gpt:
        try:
            events = _classify_with_openai(competitor, source, diff)
            return AIClassificationBatch(
                events=events,
                provider="openai",
                prompt_version=OPENAI_PROMPT_VERSION,
                status_detail=status.detail,
            )
        except Exception as exc:
            if settings.ai_provider.strip().lower() == "openai" and not settings.ai_fallback_enabled:
                raise
            if not settings.ai_fallback_enabled:
                raise
            fallback_events = _fallback_events(competitor, source, diff, f"OpenAI classification failed: {exc}")
            return AIClassificationBatch(
                events=fallback_events,
                provider="heuristic",
                prompt_version=HEURISTIC_PROMPT_VERSION,
                status_detail=f"OpenAI classification failed, fallback heuristic used: {exc}",
            )

    fallback_events = _fallback_events(competitor, source, diff, status.detail)
    return AIClassificationBatch(
        events=fallback_events,
        provider="heuristic",
        prompt_version=HEURISTIC_PROMPT_VERSION,
        status_detail=status.detail,
    )


def build_report_narrative(
    events: list[Event],
    period_start: date,
    period_end: date,
    report_type: str = "overview",
    focal_competitor=None,
    comparison_competitors=None,
) -> ReportNarrative:
    status = get_ai_runtime_status()
    if not events:
        return ReportNarrative(
            executive_summary="Không có sự kiện đối thủ nào được phê duyệt trong kỳ báo cáo này.",
            cross_market_patterns="Chưa đủ sự kiện để xác định xu hướng thị trường.",
            recommended_actions="Tiếp tục chạy crawl, phê duyệt các sự kiện có ý nghĩa, và tái tạo báo cáo khi đã có dữ liệu.",
            provider="heuristic",
            prompt_version=HEURISTIC_PROMPT_VERSION,
            status_detail="Không có sự kiện nào được phê duyệt để tổng hợp.",
        )

    if status.uses_live_gpt:
        try:
            data = _generate_report_with_openai(
                events,
                period_start,
                period_end,
                report_type=report_type,
                focal_competitor=focal_competitor,
                comparison_competitors=comparison_competitors or [],
            )
            return ReportNarrative(
                executive_summary=data["executive_summary"].strip(),
                cross_market_patterns=data["cross_market_patterns"].strip(),
                recommended_actions=data["recommended_actions"].strip(),
                provider="openai",
                prompt_version=OPENAI_PROMPT_VERSION,
                status_detail=status.detail,
            )
        except Exception as exc:
            if settings.ai_provider.strip().lower() == "openai" and not settings.ai_fallback_enabled:
                raise
            if not settings.ai_fallback_enabled:
                raise
            return _build_fallback_report(events, period_start, period_end, f"OpenAI report synthesis failed: {exc}")

    return _build_fallback_report(events, period_start, period_end, status.detail)


def _fallback_events(competitor: Competitor, source: Source, diff: DiffRecord, note: str) -> list[ClassifiedEvent]:
    events = classify_diff(competitor, source, diff)
    if not note:
        return events
    updated: list[ClassifiedEvent] = []
    for item in events:
        rationale = f"{item.rationale}. {note}".strip()
        updated.append(
            ClassifiedEvent(
                event_type=item.event_type,
                title=item.title,
                summary=item.summary,
                evidence_excerpt=item.evidence_excerpt,
                confidence_score=item.confidence_score,
                impact_score=item.impact_score,
                urgency=item.urgency,
                is_report_worthy=item.is_report_worthy,
                rationale=rationale,
            )
        )
    return updated


def _classify_with_openai(competitor: Competitor, source: Source, diff: DiffRecord) -> list[ClassifiedEvent]:
    payload = _request_openai_json(
        model=settings.openai_event_model,
        instructions=(
            "Bạn là chuyên gia phân tích cạnh tranh thị trường giáo dục và đào tạo tại Việt Nam. "
            "Đọc diff của trang web và trích xuất các thay đổi quan trọng về mặt kinh doanh của đối thủ. "
            "Ưu tiên các sự kiện cụ thể như: ra mắt sản phẩm, thay đổi giá, khuyến mãi, thay đổi định vị, "
            "cập nhật lịch học, quan hệ đối tác, gói doanh nghiệp, tín hiệu tuyển dụng, bằng chứng xã hội, hoặc chiến dịch nội dung. "
            "Nếu diff quá yếu hoặc nhiễu, trả về mảng events rỗng. "
            "QUAN TRỌNG: Viết tất cả các trường 'title', 'summary' và 'rationale' hoàn toàn bằng tiếng Việt. "
            "Trường 'summary' phải gồm 2-3 câu mô tả: (1) thay đổi cụ thể là gì, "
            "(2) ý nghĩa kinh doanh của thay đổi đó, và (3) tại sao điều này đáng chú ý với đối thủ cạnh tranh."
        ),
        user_input=json.dumps(
            {
                "competitor": {
                    "name": competitor.name,
                    "domain": competitor.primary_domain,
                    "segment": competitor.segment,
                },
                "source": {
                    "url": source.url,
                    "source_type": source.source_type,
                    "priority": source.priority,
                },
                "diff": {
                    "added_blocks": diff.added_blocks or [],
                    "removed_blocks": diff.removed_blocks or [],
                    "changed_headings": diff.changed_headings or [],
                    "changed_ctas": diff.changed_ctas or [],
                    "entities": diff.extracted_entities or {},
                },
            },
            ensure_ascii=False,
        ),
        format_name="competitor_change_events",
        schema={
            "type": "object",
            "properties": {
                "events": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "event_type": {"type": "string", "enum": EVENT_TYPES},
                            "title": {"type": "string"},
                            "summary": {"type": "string"},
                            "evidence_excerpt": {"type": "string"},
                            "confidence_score": {"type": "number"},
                            "impact_score": {"type": "number"},
                            "urgency": {"type": "string", "enum": URGENCY_LEVELS},
                            "is_report_worthy": {"type": "boolean"},
                            "rationale": {"type": "string"},
                        },
                        "required": [
                            "event_type",
                            "title",
                            "summary",
                            "evidence_excerpt",
                            "confidence_score",
                            "impact_score",
                            "urgency",
                            "is_report_worthy",
                            "rationale",
                        ],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["events"],
            "additionalProperties": False,
        },
    )

    results: list[ClassifiedEvent] = []
    for item in payload.get("events", []):
        event_type = item.get("event_type", "other")
        _EVENT_TYPE_VI_AI = {
            "product_launch": "Ra mắt sản phẩm mới",
            "product_update": "Cập nhật sản phẩm",
            "pricing_change": "Thay đổi giá",
            "promotion_launch": "Ra mắt khuyến mãi",
            "promotion_update": "Cập nhật khuyến mãi",
            "positioning_change": "Thay đổi định vị",
            "content_campaign": "Chiến dịch nội dung",
            "schedule_change": "Thay đổi lịch học",
            "partnership_update": "Cập nhật đối tác",
            "hiring_signal": "Tín hiệu tuyển dụng",
            "testimonial_or_social_proof": "Phản hồi / Bằng chứng xã hội",
            "enterprise_offer_change": "Thay đổi gói doanh nghiệp",
            "other": "Thay đổi khác",
        }
        event_type_vi = _EVENT_TYPE_VI_AI.get(event_type, event_type)
        title = item.get("title", "").strip() or f"{competitor.name}: {event_type_vi}"
        summary = item.get("summary", "").strip() or (
            f"{competitor.name} thay đổi nội dung trên trang tại {source.url}."
        )
        evidence_excerpt = item.get("evidence_excerpt", "").strip()
        rationale = item.get("rationale", "").strip() or "OpenAI classified this event from the observed diff."
        confidence_score = _clamp_score(item.get("confidence_score"), 0.0, 1.0, 0.74)
        impact_score = _clamp_score(item.get("impact_score"), 0.0, 1.0, 0.6)
        urgency = item.get("urgency") if item.get("urgency") in URGENCY_LEVELS else "medium"
        is_report_worthy = bool(item.get("is_report_worthy"))
        results.append(
            ClassifiedEvent(
                event_type=event_type,
                title=title,
                summary=summary,
                evidence_excerpt=evidence_excerpt,
                confidence_score=confidence_score,
                impact_score=impact_score,
                urgency=urgency,
                is_report_worthy=is_report_worthy,
                rationale=rationale,
            )
        )
    return results


def _generate_report_with_openai(
    events: list[Event],
    period_start: date,
    period_end: date,
    report_type: str = "overview",
    focal_competitor=None,
    comparison_competitors=None,
) -> dict[str, str]:
    comparison_competitors = comparison_competitors or []

    event_payload = [
        {
            "competitor": event.competitor.name,
            "event_type": event.event_type,
            "urgency": event.urgency,
            "title": event.title,
            "summary": event.summary,
            "source_url": event.source_url,
            "evidence_excerpt": event.evidence_excerpt or "",
            "review_status": event.review_status,
            "is_report_worthy": event.is_report_worthy,
        }
        for event in events[:50]
    ]

    focal_name = focal_competitor.name if focal_competitor else None
    comparison_names = [c.name for c in comparison_competitors] if comparison_competitors else []

    if report_type == "single_domain" and focal_name:
        instructions = (
            f"Bạn là chuyên gia phân tích cạnh tranh chiến lược trong ngành EdTech Việt Nam. "
            f"Nhiệm vụ: viết báo cáo PHÂN TÍCH CHUYÊN SÂU về đối thủ **{focal_name}** "
            f"dựa trên các tín hiệu thị trường đã được thu thập trong kỳ "
            f"{period_start.isoformat()} – {period_end.isoformat()}.\n\n"
            "Mục tiêu của báo cáo này là giúp ban lãnh đạo hiểu rõ **{focal_name} đang đi đâu, "
            "làm gì, và tại sao** — không chỉ là liệt kê thay đổi.\n\n"
            "VIẾT HOÀN TOÀN BẰNG TIẾNG VIỆT. Không dùng tiếng Anh ngoài tên riêng hoặc thuật ngữ kỹ thuật bắt buộc.\n\n"

            "━━━ PHẦN 1: executive_summary (350–600 từ) ━━━\n"
            "Viết như một bản briefing dành cho CEO/CMO, trả lời câu hỏi: "
            "**Trong kỳ này, {focal_name} đã làm gì đáng chú ý nhất?**\n"
            "- Mở đầu (2–3 câu): Nhận định tổng thể — {focal_name} đang ở giai đoạn chiến lược nào? "
            "  (mở rộng tấn công, củng cố nền tảng, phòng thủ thị phần, hay tái định vị?)\n"
            "- Phần thân: Liệt kê 4–7 động thái quan trọng nhất theo thứ tự ưu tiên giảm dần. "
            "  Mỗi mục gồm: (a) mô tả động thái cụ thể, (b) bằng chứng/trích dẫn từ dữ liệu, "
            "  (c) ý nghĩa chiến lược của nó.\n"
            "- Kết luận (2–3 câu): {focal_name} đang cố gắng chiếm lĩnh điều gì? "
            "  Họ có đang thay đổi cuộc chơi không?\n\n"

            "━━━ PHẦN 2: cross_market_patterns (250–400 từ) ━━━\n"
            "Phân tích **các pattern hành vi và chiến lược dài hạn** của {focal_name}:\n"
            "- Pattern lặp lại: Điểm gì xuất hiện nhiều lần trong kỳ? (giảm giá liên tục? ra mắt liên tiếp? "
            "  đẩy nội dung ở kênh nào?)\n"
            "- Định hướng đầu tư: {focal_name} đang đặt cược vào đâu? (sản phẩm nào, phân khúc nào, "
            "  kênh nào, đối tác nào?)\n"
            "- Điểm mạnh nổi bật: Họ đang xây dựng lợi thế cạnh tranh ở mặt nào?\n"
            "- Điểm yếu hoặc khoảng trống: Có mảng nào {focal_name} đang bỏ ngỏ hoặc phản ứng chậm không?\n"
            "- Dự báo: Dựa vào tất cả tín hiệu trên, bước đi tiếp theo của {focal_name} khả năng cao là gì?\n\n"

            "━━━ PHẦN 3: recommended_actions (250–400 từ) ━━━\n"
            "Đưa ra **4–6 hành động đối phó cụ thể**, theo thứ tự ưu tiên từ khẩn cấp đến dài hạn:\n"
            "Mỗi hành động phải tuân thủ format:\n"
            "**[Bộ phận chịu trách nhiệm]** — Hành động cụ thể cần làm là gì, dựa trên động thái nào "
            "của {focal_name} (trích dẫn sự kiện), kết quả kỳ vọng là gì, "
            "và rủi ro/hậu quả nếu không hành động trong vòng [khung thời gian].\n"
            "Tránh khuyến nghị mơ hồ như 'theo dõi thêm' hay 'cải thiện sản phẩm' — "
            "mỗi hành động phải đủ cụ thể để assign ngay vào một sprint hoặc OKR."
        ).replace("{focal_name}", focal_name)

    elif report_type == "comparison" and focal_name and comparison_names:
        others_list = ", ".join(comparison_names)
        instructions = (
            f"Bạn là chuyên gia phân tích cạnh tranh chiến lược trong ngành EdTech Việt Nam. "
            f"Nhiệm vụ: viết báo cáo SO SÁNH ĐỐI THỦ giữa **{focal_name}** (đối tượng chính) "
            f"và các đối thủ đối chiếu **{others_list}**, "
            f"dựa trên dữ liệu thu thập trong kỳ {period_start.isoformat()} – {period_end.isoformat()}.\n\n"
            "Mục tiêu báo cáo: trả lời câu hỏi **Ai đang thắng trong kỳ này? Ở mặt nào? Và ta cần làm gì?**\n\n"
            "VIẾT HOÀN TOÀN BẰNG TIẾNG VIỆT. Không dùng tiếng Anh ngoài tên riêng hoặc thuật ngữ kỹ thuật.\n\n"

            "━━━ PHẦN 1: executive_summary (350–600 từ) ━━━\n"
            f"Briefing cấp cao so sánh {focal_name} vs {others_list}:\n"
            "- Mở đầu (2–3 câu): Tổng quan bức tranh cạnh tranh kỳ này — ai đang dẫn, ai đang theo?\n"
            "- So sánh hoạt động: Trong kỳ này, mỗi đối thủ đã làm gì đáng chú ý? "
            "  Dùng cấu trúc: [Tên đối thủ] — [Động thái chính] — [Mức độ tác động].\n"
            f"- Ai đang tấn công mạnh nhất? Ai đang thụ động? {focal_name} đứng ở đâu so với nhóm?\n"
            "- Kết luận (2–3 câu): Cán cân cạnh tranh đang nghiêng về ai và tại sao?\n\n"

            "━━━ PHẦN 2: cross_market_patterns (300–450 từ) ━━━\n"
            "Phân tích so sánh đa chiều, ít nhất đề cập 3 trong các góc độ sau:\n"
            "- **Giá & Khuyến mãi**: Ai đang dùng giá làm vũ khí? Khoảng cách giá giữa các bên?\n"
            "- **Danh mục sản phẩm**: Ai đang mở rộng nhanh hơn? Ai đang tập trung? Có khoảng trống nào?\n"
            "- **Định vị & Messaging**: Mỗi bên đang nói chuyện với ai? Có sự chồng lấp hay khác biệt rõ?\n"
            "- **Tốc độ & Quy mô thay đổi**: Ai thay đổi nhiều tín hiệu nhất? Ai thay đổi ít nhưng có impact lớn?\n"
            "- **Đối tác & Hệ sinh thái**: Ai đang build network mạnh hơn?\n"
            "- **Kết luận so sánh**: Dựa vào tất cả chiều trên, {focal_name} đang dẫn ở đâu và tụt hậu ở đâu?\n\n"

            "━━━ PHẦN 3: recommended_actions (250–400 từ) ━━━\n"
            f"Đưa ra **4–6 hành động chiến lược** cho công ty chúng ta, dựa trên kết quả so sánh:\n"
            "Mỗi hành động theo format:\n"
            "**[Bộ phận]** — Hành động: [mô tả cụ thể], "
            "Lý do: dựa trên [tên đối thủ] đang làm [sự kiện cụ thể], "
            "Kết quả kỳ vọng: [mục tiêu đo được], "
            "Hậu quả nếu bỏ qua: [rủi ro cụ thể].\n"
            "Ưu tiên hành động phòng thủ (đáp lại đối thủ mạnh) trước, "
            "sau đó hành động tấn công (khai thác điểm yếu của đối thủ)."
        ).replace("{focal_name}", focal_name)

    else:
        # "overview" — broad market-wide analysis
        instructions = (
            "Bạn là chuyên gia phân tích cạnh tranh hàng đầu, viết báo cáo tình báo định kỳ cho ban lãnh đạo và "
            "đội thương mại của một công ty EdTech tại Việt Nam. "
            "Nhiệm vụ: tổng hợp các sự kiện cạnh tranh đã xác nhận thành báo cáo chuyên nghiệp, giàu thông tin, và hành động được ngay. "
            "VIẾT HOÀN TOÀN BẰNG TIẾNG VIỆT, tránh hỗn Anh-Việt.\n\n"
            "Yêu cầu cho từng phần:\n\n"
            "1. executive_summary (250–500 từ):\n"
            "   - Mở đầu: 1–2 câu nêu bật tổng quan tình hình cạnh tranh trong kỳ.\n"
            "   - Danh sách động thái chính: liệt kê theo bullet từng đối thủ có tín hiệu quan trọng, "
            "     mỗi bullet nêu: đối thủ làm gì, khi nào, mức độ tác động.\n"
            "   - Kết luận: nhận định tổng thể về xu hướng đang hình thành trong kỳ này.\n"
            "   - Tránh ngôn ngữ hoa mỹ, nhất quán dùng tên đối thủ và sự kiện cụ thể.\n\n"
            "2. cross_market_patterns (200–350 từ):\n"
            "   - Pattern lặp lại: các dạng thay đổi nào xuất hiện nhiều lần hoặc ở nhiều đối thủ?\n"
            "   - Phân tích chiều sâu: các thay đổi này phản ánh chiến lược dài hạn hay phản ứng ngắn hạn?\n"
            "   - Lĩnh vực đang được đầu tư: chỉ rõ đối thủ nào đang push mạnh ở mảng nào.\n"
            "   - Dự báo: dựa vào các tín hiệu này, bước đi tiếp theo của đối thủ có thể là gì?\n\n"
            "3. recommended_actions (200–350 từ):\n"
            "   - Đưa ra 3–5 hành động cụ thể, ưu tiên theo mức độ cấp thiết.\n"
            "   - Mỗi hành động phải: (a) chỉ rõ bộ phận nào cần thực hiện, "
            "     (b) liên kết trực tiếp với một sự kiện đối thủ cụ thể trong danh sách, "
            "     (c) nêu rõ kết quả kỳ vọng hoặc rủi ro nếu không hành động.\n"
            "   - Tránh khuyến nghị chung chung không gắn với dữ liệu thực tế."
        )

    return _request_openai_json(
        model=settings.openai_report_model,
        instructions=instructions,
        user_input=json.dumps(
            {
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "report_type": report_type,
                "focal_competitor": focal_name,
                "comparison_competitors": comparison_names,
                "approved_events": event_payload,
            },
            ensure_ascii=False,
        ),
        format_name="competitor_report_sections",
        schema={
            "type": "object",
            "properties": {
                "executive_summary": {"type": "string"},
                "cross_market_patterns": {"type": "string"},
                "recommended_actions": {"type": "string"},
            },
            "required": ["executive_summary", "cross_market_patterns", "recommended_actions"],
            "additionalProperties": False,
        },
    )


def _build_fallback_report(events: list[Event], period_start: date, period_end: date, note: str) -> ReportNarrative:
    competitor_counts: dict[str, int] = {}
    type_counts: dict[str, int] = {}
    urgent_items: list[Event] = []
    for event in events:
        competitor_counts[event.competitor.name] = competitor_counts.get(event.competitor.name, 0) + 1
        type_counts[event.event_type] = type_counts.get(event.event_type, 0) + 1
        if event.urgency == "high":
            urgent_items.append(event)

    top_competitors = ", ".join(
        f"{name} ({count})" for name, count in sorted(competitor_counts.items(), key=lambda item: item[1], reverse=True)[:3]
    ) or "Không có đối thủ nổi trội"
    top_types = ", ".join(
        f"{name.replace('_', ' ')} ({count})"
        for name, count in sorted(type_counts.items(), key=lambda item: item[1], reverse=True)[:3]
    ) or "Không có kiểu thay đổi lặp lại"
    urgent_summary = ", ".join(item.title for item in urgent_items[:3]) or "Không có thay đổi khẩn cấp"

    return ReportNarrative(
        executive_summary=(
            f"Trong kỳ từ {period_start.isoformat()} đến {period_end.isoformat()}, lượng tín hiệu "
            f"cạnh tranh lớn nhất đến từ {top_competitors}. "
            f"Các kiểu thay đổi phổ biến nhất: {top_types}."
        ),
        cross_market_patterns=(
            f"Các tín hiệu được phê duyệt tập trung vào {top_types}. "
            f"Các mục khẩn nhất trong hàng đợi hiện tại: {urgent_summary}."
        ),
        recommended_actions=(
            "Kiểm tra các động thái về giá và khuyến mại trước, so sánh định vị sản phẩm so với "
            "các trang landing page hiện tại của bạn, và cập nhật tài liệu đội sale với các message "
            "hoặc offer mới từ đối thủ."
        ),
        provider="heuristic",
        prompt_version=HEURISTIC_PROMPT_VERSION,
        status_detail=note,
    )


def _request_openai_json(model: str, instructions: str, user_input: str, format_name: str, schema: dict[str, Any]) -> dict[str, Any]:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    base = settings.openai_api_base.rstrip("/")
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    # gpt-3.5-turbo and Azure gpt-35-turbo do not support the Responses API.
    # Use the Chat Completions endpoint with JSON mode for those models.
    if model.startswith("gpt-3.5") or model.startswith("gpt-35"):
        endpoint = f"{base}/chat/completions"
        response = httpx.post(
            endpoint,
            headers=headers,
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": user_input},
                ],
                "response_format": {"type": "json_object"},
            },
            timeout=settings.openai_timeout_seconds,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"OpenAI request failed with status {response.status_code}: {response.text[:240]}")
        payload = response.json()
        output_text = (payload.get("choices") or [{}])[0].get("message", {}).get("content", "")
        if not output_text:
            raise RuntimeError("OpenAI response did not include output text.")
        return json.loads(output_text)

    # For gpt-4o and newer models use the Responses API with strict JSON schema.
    endpoint = f"{base}/responses"
    response = httpx.post(
        endpoint,
        headers=headers,
        json={
            "model": model,
            "instructions": instructions,
            "input": user_input,
            "store": False,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": format_name,
                    "strict": True,
                    "schema": schema,
                }
            },
        },
        timeout=settings.openai_timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"OpenAI request failed with status {response.status_code}: {response.text[:240]}")

    payload = response.json()
    output_text = _extract_output_text(payload)
    if not output_text:
        raise RuntimeError("OpenAI response did not include output text.")
    return json.loads(output_text)


def _extract_output_text(payload: dict[str, Any]) -> str:
    collected: list[str] = []
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content_item in item.get("content", []):
            if content_item.get("type") == "output_text" and content_item.get("text"):
                collected.append(content_item["text"])
    return "\n".join(collected).strip()


def _clamp_score(value: Any, floor: float, ceiling: float, default: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = default
    return round(min(max(numeric, floor), ceiling), 4)
