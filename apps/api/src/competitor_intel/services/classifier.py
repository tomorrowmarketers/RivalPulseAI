from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from competitor_intel.models import Competitor, DiffRecord, Source
from competitor_intel.services.text_utils import normalize_text


HEURISTIC_PROMPT_VERSION = "heuristic-v2"

PROMO_KEYWORDS = ["khuyen mai", "uu dai", "discount", "sale", "scholarship", "voucher", "promotion"]
PRICE_KEYWORDS = ["hoc phi", "price", "pricing", "fee", "vnd", "$", "gia uu dai"]
SCHEDULE_KEYWORDS = ["khai giang", "cohort", "deadline", "lich hoc", "starts", "open class", "lich khai giang"]
PARTNERSHIP_KEYWORDS = ["partner", "doi tac", "microsoft", "aws", "google", "certified"]
ENTERPRISE_KEYWORDS = ["doanh nghiep", "enterprise", "corporate", "b2b", "in-house"]
PRODUCT_KEYWORDS = ["khoa hoc", "course", "bootcamp", "program", "training", "lop hoc", "workshop"]
HIRING_KEYWORDS = ["tuyen dung", "career", "hiring", "join us"]
SOCIAL_PROOF_KEYWORDS = ["testimonial", "case study", "success story", "danh gia", "hoc vien"]
POSITIONING_KEYWORDS = ["ai", "analytics", "data", "business intelligence", "agent", "career"]


@dataclass(slots=True)
class ClassifiedEvent:
    event_type: str
    title: str
    summary: str
    evidence_excerpt: str
    confidence_score: float
    impact_score: float
    urgency: str
    is_report_worthy: bool
    rationale: str


def _normalize_for_match(value: str) -> str:
    normalized = normalize_text(value).lower()
    normalized = unicodedata.normalize("NFKD", normalized)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_text.split())


def _contains_any(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def classify_diff(competitor: Competitor, source: Source, diff: DiffRecord) -> list[ClassifiedEvent]:
    added = " ".join(diff.added_blocks or [])
    removed = " ".join(diff.removed_blocks or [])
    headings = " ".join(diff.changed_headings or [])
    ctas = " ".join(diff.changed_ctas or [])
    joined = " ".join(part for part in [added, removed, headings, ctas] if part).strip()

    if not joined:
        return []

    joined_for_match = _normalize_for_match(joined)
    event_type = "other"
    rationale_parts: list[str] = []

    if _contains_any(joined_for_match, PROMO_KEYWORDS):
        event_type = "promotion_launch"
        rationale_parts.append("promotion keywords detected")
    if _contains_any(joined_for_match, PRICE_KEYWORDS) or diff.extracted_entities.get("prices"):
        event_type = "pricing_change"
        rationale_parts.append("pricing signals detected")
    if _contains_any(joined_for_match, SCHEDULE_KEYWORDS):
        event_type = "schedule_change"
        rationale_parts.append("schedule signals detected")
    if _contains_any(joined_for_match, PARTNERSHIP_KEYWORDS):
        event_type = "partnership_update"
        rationale_parts.append("partnership signals detected")
    if _contains_any(joined_for_match, ENTERPRISE_KEYWORDS) or source.source_type == "enterprise":
        event_type = "enterprise_offer_change"
        rationale_parts.append("enterprise signals detected")
    if _contains_any(joined_for_match, HIRING_KEYWORDS):
        event_type = "hiring_signal"
        rationale_parts.append("hiring signals detected")
    if _contains_any(joined_for_match, SOCIAL_PROOF_KEYWORDS):
        event_type = "testimonial_or_social_proof"
        rationale_parts.append("social proof signals detected")
    if source.source_type in {"course_catalog", "course_detail"} and _contains_any(joined_for_match, PRODUCT_KEYWORDS):
        event_type = "product_launch"
        rationale_parts.append("product signals detected in course pages")
    if source.source_type == "homepage" and _contains_any(joined_for_match, POSITIONING_KEYWORDS):
        event_type = "positioning_change"
        rationale_parts.append("positioning signals detected on homepage")
    if source.source_type in {"blog", "event", "landing_page"}:
        event_type = "content_campaign"
        rationale_parts.append("campaign or content page changed")

    excerpt_source = (diff.added_blocks or [])[:3] or (diff.changed_headings or [])[:3] or (diff.changed_ctas or [])[:3]
    evidence_excerpt = " | ".join(excerpt_source)
    confidence = 0.62
    if event_type != "other":
        confidence += 0.18
    if source.priority == "high":
        confidence += 0.08
    if diff.extracted_entities.get("prices") or diff.extracted_entities.get("percentages"):
        confidence += 0.05
    confidence = min(confidence, 0.97)

    impact = 0.45
    if event_type in {"product_launch", "pricing_change", "promotion_launch", "enterprise_offer_change"}:
        impact += 0.25
    if source.priority == "high":
        impact += 0.15
    impact = min(impact, 0.95)

    urgency = "low"
    if impact >= 0.75:
        urgency = "high"
    elif impact >= 0.55:
        urgency = "medium"

    report_worthy = impact >= 0.7 or event_type in {"pricing_change", "product_launch", "promotion_launch"}

    _EVENT_TYPE_VI = {
        "product_launch": "Ra m\u1eaft s\u1ea3n ph\u1ea9m m\u1edbi",
        "product_update": "C\u1eadp nh\u1eadt s\u1ea3n ph\u1ea9m",
        "pricing_change": "Thay \u0111\u1ed5i gi\u00e1",
        "promotion_launch": "Ra m\u1eaft khuy\u1ebfn m\u00e3i",
        "promotion_update": "C\u1eadp nh\u1eadt khuy\u1ebfn m\u00e3i",
        "positioning_change": "Thay \u0111\u1ed5i \u0111\u1ecbnh v\u1ecb",
        "content_campaign": "Chi\u1ebfn d\u1ecbch n\u1ed9i dung",
        "schedule_change": "Thay \u0111\u1ed5i l\u1ecbch h\u1ecdc",
        "partnership_update": "C\u1eadp nh\u1eadt \u0111\u1ed1i t\u00e1c",
        "hiring_signal": "T\u00edn hi\u1ec7u tuy\u1ec3n d\u1ee5ng",
        "testimonial_or_social_proof": "Ph\u1ea3n h\u1ed3i / B\u1eb1ng ch\u1ee9ng x\u00e3 h\u1ed9i",
        "enterprise_offer_change": "Thay \u0111\u1ed5i g\u00f3i doanh nghi\u1ec7p",
        "other": "Thay \u0111\u1ed5i kh\u00e1c",
    }
    _SOURCE_TYPE_VI = {
        "homepage": "trang ch\u1ee7",
        "course_catalog": "danh m\u1ee5c kh\u00f3a h\u1ecdc",
        "course_detail": "chi ti\u1ebft kh\u00f3a h\u1ecdc",
        "blog": "blog",
        "event": "s\u1ef1 ki\u1ec7n",
        "pricing": "b\u1ea3ng gi\u00e1",
        "about": "gi\u1edbi thi\u1ec7u",
        "enterprise": "doanh nghi\u1ec7p",
        "landing_page": "landing page",
        "other": "kh\u00e1c",
    }
    event_type_vi = _EVENT_TYPE_VI.get(event_type, event_type)
    source_type_vi = _SOURCE_TYPE_VI.get(source.source_type, source.source_type)
    title = f"{competitor.name}: {event_type_vi}"

    # Build a more descriptive summary that includes evidence from the diff.
    evidence_note = ""
    first_added = next((b.strip() for b in (diff.added_blocks or []) if b.strip()), "")
    first_heading = next((h.strip() for h in (diff.changed_headings or []) if h.strip()), "")
    first_cta = next((c.strip() for c in (diff.changed_ctas or []) if c.strip()), "")
    if first_added:
        snippet = first_added[:180]
        evidence_note = f' Nội dung mới ghi nhận: "{snippet}".'
    elif first_heading:
        evidence_note = f" Tiêu đề thay đổi: {first_heading}."
    elif first_cta:
        evidence_note = f" Nút/CTA thay đổi: {first_cta}."

    summary = (
        f"{competitor.name} vừa cập nhật trang {source_type_vi} — hệ thống phân loại tín hiệu là: {event_type_vi}.{evidence_note} "
        f"Đây là kết quả phân tích heuristic tự động; hãy kiểm tra trang nguồn để xác nhận chi tiết."
    )
    rationale = ", ".join(rationale_parts) if rationale_parts else "ph\u00e2n t\u00edch heuristic"

    return [
        ClassifiedEvent(
            event_type=event_type,
            title=title,
            summary=summary,
            evidence_excerpt=evidence_excerpt,
            confidence_score=round(confidence, 4),
            impact_score=round(impact, 4),
            urgency=urgency,
            is_report_worthy=report_worthy,
            rationale=rationale,
        )
    ]
