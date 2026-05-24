from __future__ import annotations

import re
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

# Compiled patterns for structured data detection
_PRICE_RE = re.compile(r"\d[\d\.,]+\s*(vnd|đ|usd|\$|tr|triệu|million)", re.IGNORECASE)
_DATE_RE = re.compile(r"\d{1,2}[/\-\.]\d{1,2}([/\-\.]\d{2,4})?|\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2}")

_EVENT_TYPE_VI: dict[str, str] = {
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

_IMPACT_BY_TYPE: dict[str, float] = {
    "pricing_change": 0.85,
    "promotion_launch": 0.75,
    "product_launch": 0.80,
    "enterprise_offer_change": 0.80,
    "partnership_update": 0.70,
    "schedule_change": 0.65,
    "positioning_change": 0.60,
    "hiring_signal": 0.55,
    "testimonial_or_social_proof": 0.45,
    "content_campaign": 0.45,
    "other": 0.40,
}

_REPORT_WORTHY_TYPES = {"pricing_change", "product_launch", "promotion_launch", "enterprise_offer_change", "partnership_update"}


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


def _build_title(comp_name: str, event_type: str, first_block: str) -> str:
    """Build a specific, concise event title from the first relevant evidence block."""
    short = first_block[:70].strip()
    label = _EVENT_TYPE_VI.get(event_type, event_type)
    if not short:
        return f"{comp_name}: {label}"
    prefixes = {
        "pricing_change": "Giá thay đổi",
        "promotion_launch": "Ưu đãi mới",
        "schedule_change": "Lịch mới",
        "partnership_update": "Hợp tác",
        "enterprise_offer_change": "Gói doanh nghiệp",
        "hiring_signal": "Tuyển dụng",
        "product_launch": "Khóa học mới",
        "positioning_change": "Định vị",
        "content_campaign": "Nội dung",
        "testimonial_or_social_proof": "Đánh giá mới",
    }
    prefix = prefixes.get(event_type)
    if prefix:
        return f"{prefix}: {short}"
    return f"{comp_name}: {short}"


def _build_summary(event_type: str, added: list[str], removed: list[str], entities: dict) -> str:
    """Build a structured, data-driven summary showing what actually changed."""
    def fmt(blocks: list[str], limit: int = 3) -> str:
        return " · ".join(b[:100].strip() for b in blocks[:limit] if b.strip())

    if event_type == "pricing_change":
        parts = []
        if removed:
            parts.append(f"Cũ: {fmt(removed, 2)}")
        if added:
            parts.append(f"Mới: {fmt(added, 2)}")
        pct = entities.get("percentages", [])
        if pct:
            parts.append(f"Biến động: {', '.join(pct[:3])}")
        return " | ".join(parts) if parts else fmt(added + removed)

    if event_type == "promotion_launch":
        pct = entities.get("percentages", [])
        base = fmt(added)
        return base + (f" (giảm {', '.join(pct[:2])})" if pct else "")

    if event_type == "schedule_change":
        parts = []
        if removed:
            parts.append(f"Lịch cũ: {fmt(removed, 2)}")
        if added:
            parts.append(f"Lịch mới: {fmt(added, 2)}")
        return " | ".join(parts) if parts else fmt(added + removed)

    if event_type == "hiring_signal":
        return "Vị trí mở: " + fmt(added)

    # Default: added then removed
    parts = []
    if added:
        parts.append(fmt(added))
    if removed:
        parts.append(f"[đã xóa: {fmt(removed, 2)}]")
    return " | ".join(parts) if parts else "Nội dung thay đổi"


def classify_diff(competitor: Competitor, source: Source, diff: DiffRecord) -> list[ClassifiedEvent]:
    """Classify a diff into one or more distinct signal events.

    Each detected signal type (pricing, promo, schedule, etc.) becomes a
    separate ClassifiedEvent so callers can surface them individually.
    """
    added_blocks = diff.added_blocks or []
    removed_blocks = diff.removed_blocks or []
    headings = diff.changed_headings or []
    ctas = diff.changed_ctas or []
    entities: dict = diff.extracted_entities or {}

    if not (added_blocks or removed_blocks or headings or ctas):
        return []

    def match_added(keywords: list[str]) -> list[str]:
        return [b for b in added_blocks if _contains_any(_normalize_for_match(b), keywords)]

    def match_removed(keywords: list[str]) -> list[str]:
        return [b for b in removed_blocks if _contains_any(_normalize_for_match(b), keywords)]

    # --- Detect all signal types independently ---
    # Each entry: (event_type, relevant_added_blocks, relevant_removed_blocks)
    signals: list[tuple[str, list[str], list[str]]] = []

    # 1. Pricing: blocks containing price keywords or price-like numbers
    price_added = [b for b in added_blocks if _contains_any(_normalize_for_match(b), PRICE_KEYWORDS) or _PRICE_RE.search(b)]
    price_removed = [b for b in removed_blocks if _contains_any(_normalize_for_match(b), PRICE_KEYWORDS) or _PRICE_RE.search(b)]
    if price_added or price_removed or entities.get("prices"):
        signals.append(("pricing_change", price_added, price_removed))

    # 2. Promotion
    promo_added = match_added(PROMO_KEYWORDS)
    if promo_added:
        signals.append(("promotion_launch", promo_added, []))

    # 3. Schedule: date patterns or schedule keywords
    sched_added = [b for b in added_blocks if _contains_any(_normalize_for_match(b), SCHEDULE_KEYWORDS) or _DATE_RE.search(b)]
    sched_removed = [b for b in removed_blocks if _contains_any(_normalize_for_match(b), SCHEDULE_KEYWORDS) or _DATE_RE.search(b)]
    if sched_added or sched_removed:
        signals.append(("schedule_change", sched_added, sched_removed))

    # 4. Partnership
    partner_added = match_added(PARTNERSHIP_KEYWORDS)
    if partner_added:
        signals.append(("partnership_update", partner_added, []))

    # 5. Enterprise
    if source.source_type == "enterprise":
        signals.append(("enterprise_offer_change", added_blocks[:5], []))
    else:
        ent_added = match_added(ENTERPRISE_KEYWORDS)
        if ent_added:
            signals.append(("enterprise_offer_change", ent_added, []))

    # 6. Hiring
    hire_added = match_added(HIRING_KEYWORDS)
    if hire_added:
        signals.append(("hiring_signal", hire_added, []))

    # 7. Social proof
    social_added = match_added(SOCIAL_PROOF_KEYWORDS)
    if social_added:
        signals.append(("testimonial_or_social_proof", social_added, []))

    # 8. Product launch (only on course pages to avoid false positives)
    if source.source_type in {"course_catalog", "course_detail"}:
        prod_added = match_added(PRODUCT_KEYWORDS)
        if prod_added:
            signals.append(("product_launch", prod_added, []))

    # 9. Positioning (homepage only)
    if source.source_type == "homepage":
        pos_added = match_added(POSITIONING_KEYWORDS)
        if pos_added:
            signals.append(("positioning_change", pos_added, []))

    # 10. Content campaign (blog/event/landing pages)
    if source.source_type in {"blog", "event", "landing_page"}:
        signals.append(("content_campaign", added_blocks[:5], []))

    # Fallback when no specific signal found
    if not signals:
        fallback = (added_blocks or headings or ctas or removed_blocks)[:5]
        signals.append(("other", fallback, []))

    # Deduplicate: keep first occurrence per event_type
    seen: set[str] = set()
    unique_signals: list[tuple[str, list[str], list[str]]] = []
    for sig in signals:
        if sig[0] not in seen:
            seen.add(sig[0])
            unique_signals.append(sig)

    # --- Build one ClassifiedEvent per unique signal ---
    results: list[ClassifiedEvent] = []
    for event_type, ev_added, ev_removed in unique_signals:
        all_evidence = ev_added + ev_removed
        first = (ev_added[0] if ev_added else ev_removed[0] if ev_removed else "").strip()

        title = _build_title(competitor.name, event_type, first)
        summary = _build_summary(event_type, ev_added, ev_removed, entities)
        evidence_excerpt = " | ".join(b[:120] for b in all_evidence[:3])

        impact = _IMPACT_BY_TYPE.get(event_type, 0.40)
        if source.priority == "high":
            impact = min(impact + 0.10, 0.95)

        confidence = 0.80 if event_type not in {"other", "content_campaign"} else 0.62
        if entities.get("prices") or entities.get("percentages"):
            confidence = min(confidence + 0.05, 0.97)

        urgency = "high" if impact >= 0.75 else "medium" if impact >= 0.55 else "low"
        report_worthy = event_type in _REPORT_WORTHY_TYPES

        results.append(ClassifiedEvent(
            event_type=event_type,
            title=title,
            summary=summary,
            evidence_excerpt=evidence_excerpt,
            confidence_score=round(confidence, 4),
            impact_score=round(impact, 4),
            urgency=urgency,
            is_report_worthy=report_worthy,
            rationale=f"{event_type}: {len(all_evidence)} block(s) matched",
        ))

    return results
