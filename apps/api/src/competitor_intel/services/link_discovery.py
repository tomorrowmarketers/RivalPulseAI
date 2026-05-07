"""Link discovery service.

Given a seed URL this module:
1. Deep-crawls the domain (BFS up to 60 pages) and extracts page metadata.
2. Uses heuristics (or AI when available) to categorise into 3 buckets:
   san_pham (San pham) / khuyen_mai (Khuyen mai) / other (Khac)
3. Optionally compares against known links stored in the DB to flag newly
   appearing links on subsequent re-scans.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Callable

from sqlalchemy.orm import Session

from competitor_intel.models import Competitor, DiscoveredLink, DiscoverySeed, Source
from competitor_intel.services.ai import _request_openai_json, get_ai_runtime_status
from competitor_intel.services.crawler import deep_discover_pages, discover_links
from competitor_intel.services.notifications import write_notification
from competitor_intel.services.url_utils import canonicalize_monitored_url, is_noise_url

CATEGORIES = {
    "san_pham": "Sản phẩm",
    "khuyen_mai": "Khuyến mại",
    "other": "Khác",
    "skip": "Bỏ qua",
}

_HEURISTIC_RULES: list[tuple[str, list[str]]] = [
    ("khuyen_mai", [
        r"/khuyen-mai", r"/uu-dai", r"/sale\b", r"/offer", r"/giam-gia", r"/promotion",
        r"/deal\b", r"/discount", r"/scholarship", r"/hoc-bong", r"/voucher",
        r"khuyen mai", r"uu dai", r"giam gia", r"hoc bong", r"discount", r"scholarship",
    ]),
    ("san_pham", [
        r"/course", r"/khoa-hoc", r"/chuong-trinh", r"/program", r"/study-program",
        r"/dao-tao", r"/training", r"/lop-hoc", r"/class\b", r"/curriculum", r"/bootcamp",
        r"/price", r"/gia\b", r"/hoc-phi", r"/bang-gia", r"/pricing", r"/tariff", r"/fee\b",
        r"/dang-ky", r"/tuyen-sinh", r"/register", r"/admission", r"/enroll", r"/nhap-hoc",
        r"khoa hoc", r"chuong trinh", r"hoc phi", r"bang gia", r"tuyen sinh", r"dang ky",
    ]),
]

_OTHER_RULES = [
    r"/blog", r"/tin-tuc", r"/news", r"/insights", r"/resources", r"/su-kien", r"/event",
    r"/ve-chung-toi", r"/about", r"/gioi-thieu", r"/contact", r"/lien-he", r"/faq",
    r"/career", r"/careers", r"/tuyen-dung", r"/privacy", r"/terms", r"/legal",
    r"tin tuc", r"blog", r"gioi thieu", r"lien he", r"tuyen dung", r"faq",
]

_AI_TITLE_LIMIT = 120
_AI_TEXT_LIMIT = 80


@dataclass
class CategorisedLink:
    url: str
    link_text: str
    category: str
    ai_reason: str
    page_title: str | None = field(default=None)


def _compact_text(value: str, limit: int) -> str:
    normalized = re.sub(r"\s+", " ", (value or "")).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(0, limit - 3)].rstrip() + "..."


def _heuristic_category(url: str, text: str, title: str = "") -> tuple[str, str, bool]:
    # Noise check first — highest priority
    if is_noise_url(url):
        return "skip", "URL cấu trúc rác (phân trang / tác giả / pháp lý)", True
    haystack = " ".join(part for part in (url, text or "", title or "") if part).lower()
    matches: dict[str, list[str]] = {}
    for cat, patterns in [*_HEURISTIC_RULES, ("other", _OTHER_RULES)]:
        matched_patterns = [pat for pat in patterns if re.search(pat, haystack)]
        if matched_patterns:
            matches[cat] = matched_patterns

    if not matches:
        return "other", "Chua du tin hieu de chot som", False
    if len(matches) == 1:
        cat, matched_patterns = next(iter(matches.items()))
        return cat, f"Khop heuristic: {matched_patterns[0]}", True
    return "other", "Tin hieu chong cheo, can AI quyet dinh", False


def _heuristic_result(link: dict) -> tuple[CategorisedLink, bool]:
    canonical_url = canonicalize_monitored_url(link["url"])
    category, reason, confident = _heuristic_category(canonical_url, link.get("text", ""), link.get("title", ""))
    return (
        CategorisedLink(
            url=canonical_url,
            link_text=link.get("text", ""),
            category=category,
            ai_reason=reason,
        ),
        confident,
    )


def _compact_link_for_ai(link: dict) -> dict[str, str]:
    title = _compact_text(link.get("title", ""), _AI_TITLE_LIMIT)
    text = _compact_text(link.get("text", ""), _AI_TEXT_LIMIT)
    payload = {"url": canonicalize_monitored_url(link["url"])}
    if title:
        payload["title"] = title
    if text and text.lower() != title.lower():
        payload["text"] = text
    return payload


def _dedupe_categorised_links(items: list[CategorisedLink]) -> list[CategorisedLink]:
    seen: set[str] = set()
    unique: list[CategorisedLink] = []
    for item in items:
        url = canonicalize_monitored_url(item.url)
        item.url = url
        if url in seen:
            continue
        seen.add(url)
        unique.append(item)
    return unique


def _source_lookup_by_canonical(db: Session, seed: DiscoverySeed) -> dict[str, Source]:
    lookup: dict[str, Source] = {}
    sources = db.query(Source).filter(
        Source.tenant_id == seed.tenant_id,
        Source.competitor_id == seed.competitor_id,
    ).all()
    for source in sources:
        canonical = canonicalize_monitored_url(source.url)
        current = lookup.get(canonical)
        if current is None or (source.url == canonical and current.url != canonical):
            lookup[canonical] = source
    return lookup


def _ai_categorise_3(
    links: list[dict],
    progress: Callable[[str], None] | None = None,
) -> list[CategorisedLink]:
    status = get_ai_runtime_status()
    heuristic_lookup: dict[str, CategorisedLink] = {}
    ambiguous_links: list[dict] = []
    confident_count = 0

    for link in links:
        canonical_url = canonicalize_monitored_url(link["url"])
        item, confident = _heuristic_result(link)
        heuristic_lookup[canonical_url] = item
        if confident:
            confident_count += 1
        else:
            ambiguous_links.append({**link, "url": canonical_url})

    if not status.uses_live_gpt:
        if progress:
            progress(f"Đang nhóm {len(links)} trang bằng bộ quy tắc mặc định")
        return [heuristic_lookup[canonicalize_monitored_url(l["url"])] for l in links]

    if progress and confident_count:
        progress(f"Đã chốt nhanh {confident_count} trang bằng URL và tiêu đề")
    if not ambiguous_links:
        if progress:
            progress("Mọi trang đã rõ category, không cần gọi AI")
        return [heuristic_lookup[canonicalize_monitored_url(l["url"])] for l in links]

    try:
        if progress:
            progress(f"AI đang nhóm {len(ambiguous_links)}/{len(links)} trang chưa rõ category")
        payload = _request_openai_json(
            model="gpt-4o-mini",
            instructions=(
                "Classify each page URL into exactly one of 3 categories: "
                "san_pham = product/course/pricing/enrollment pages, "
                "khuyen_mai = promotion/discount/scholarship pages, "
                "other = everything else. "
                "Return a JSON object with a 'links' array."
            ),
            user_input=json.dumps(
                {"links": [_compact_link_for_ai(link) for link in ambiguous_links]},
                ensure_ascii=False,
            ),
            format_name="link_categories_3",
            schema={
                "type": "object",
                "properties": {
                    "links": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "url": {"type": "string"},
                                "category": {"type": "string", "enum": list(CATEGORIES.keys())},
                                "reason": {"type": "string"},
                            },
                            "required": ["url", "category", "reason"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["links"],
                "additionalProperties": False,
            },
        )
    except Exception:
        if progress:
            progress("AI tạm thời chưa sẵn sàng, hệ thống chuyển sang cách nhóm mặc định")
        return [heuristic_lookup[canonicalize_monitored_url(l["url"])] for l in links]
    lookup = {item["url"]: (item["category"], item.get("reason", "")) for item in payload.get("links", [])}
    results: list[CategorisedLink] = []
    for l in links:
        canonical_url = canonicalize_monitored_url(l["url"])
        if canonical_url in lookup:
            cat, reason = lookup[canonical_url]
            results.append(CategorisedLink(url=canonical_url, link_text=l.get("text", ""), category=cat, ai_reason=reason))
            continue
        results.append(heuristic_lookup[canonical_url])
    return results


def scan_and_categorise(seed_url: str, include_pattern: str | None = None) -> list[CategorisedLink]:
    raw_links = discover_links(seed_url, include_pattern)
    if not raw_links:
        return []
    results = _dedupe_categorised_links(_ai_categorise_3(raw_links))
    return [r for r in results if r.category != "skip"]


def scan_and_categorise_deep(
    seed_url: str,
    max_pages: int = 60,
    progress: Callable[[str], None] | None = None,
) -> list[CategorisedLink]:
    if progress:
        progress(f"Bắt đầu quét từ trang gốc {seed_url}")
    page_infos = deep_discover_pages(seed_url, max_pages=max_pages, progress=progress)
    if not page_infos:
        if progress:
            progress("Không tìm thấy thêm trang nội bộ nào để theo dõi")
        return []
    # Deduplicate by URL (safety net on top of deep_discover_pages dedup)
    seen: set[str] = set()
    unique_infos: list = []
    for info in page_infos:
        if info.url in seen:
            continue
        seen.add(info.url)
        unique_infos.append(info)
    if progress:
        progress(f"Đang loại bỏ URL trùng và chốt danh sách {len(unique_infos)} trang")
    links = [{"url": p.url, "text": p.link_text, "title": p.page_title or ""} for p in unique_infos]
    title_lookup = {p.url: p.page_title for p in unique_infos}
    categorised = _dedupe_categorised_links(_ai_categorise_3(links, progress=progress))
    # Filter out noise pages (pagination, author pages, legal, etc.)
    categorised = [c for c in categorised if c.category != "skip"]
    for item in categorised:
        item.page_title = title_lookup.get(item.url)
    if progress:
        progress(f"Hoàn tất. Đã nhận diện {len(categorised)} trang để bạn xem lại")
    return categorised


def rescan_due_seeds(db: Session) -> int:
    now = datetime.now(UTC)
    seeds = db.query(DiscoverySeed).filter(DiscoverySeed.is_active.is_(True)).all()
    new_link_count = 0
    for seed in seeds:
        due_at = (
            seed.last_scanned_at + timedelta(hours=seed.scan_frequency_hours)
            if seed.last_scanned_at else None
        )
        if due_at and due_at > now:
            continue
        try:
            categorised = scan_and_categorise(seed.seed_url)
        except Exception:
            continue
        existing_links_by_url = {
            canonicalize_monitored_url(link.url): link
            for link in db.query(DiscoveredLink).filter(DiscoveredLink.seed_id == seed.id).all()
        }
        newly_added: list[DiscoveredLink] = []
        seen_in_batch: set[str] = set()
        for item in categorised:
            item.url = canonicalize_monitored_url(item.url)
            existing_link = existing_links_by_url.get(item.url)
            if existing_link:
                existing_link.last_seen_at = now
                existing_link.is_new = False
                continue
            if item.url in seen_in_batch:
                continue
            seen_in_batch.add(item.url)
            new_link = DiscoveredLink(
                tenant_id=seed.tenant_id, seed_id=seed.id, url=item.url,
                link_text=item.link_text, category=item.category, ai_reason=item.ai_reason,
                page_title=item.page_title, status="pending", is_new=True,
                first_seen_at=now, last_seen_at=now,
            )
            db.add(new_link)
            newly_added.append(new_link)
        seed.last_scanned_at = now
        db.flush()
        if newly_added:
            new_link_count += len(newly_added)
            if seed.auto_approve_new_links:
                approve_links(db, seed, [l.id for l in newly_added],
                              source_type=seed.auto_source_type or "other",
                              crawl_frequency_hours=seed.auto_crawl_frequency_hours or 48)
                action_label = "auto-approved"
            else:
                seed.pending_count = db.query(DiscoveredLink).filter(DiscoveredLink.seed_id == seed.id, DiscoveredLink.status == "pending").count()
                action_label = "pending"
            competitor = db.query(Competitor).filter(Competitor.id == seed.competitor_id).first()
            write_notification("new_links", {
                "seed_id": seed.id, "seed_url": seed.seed_url,
                "competitor_name": competitor.name if competitor else "",
                "action": action_label,
                "new_links": [{"url": l.url, "category": l.category, "text": l.link_text} for l in newly_added],
            })
    db.commit()
    return new_link_count


def approve_links(db: Session, seed: DiscoverySeed, link_ids: list[str],
                  source_type: str = "other", crawl_frequency_hours: int = 48,
                  page_category: str | None = None) -> list[Source]:
    created: list[Source] = []
    existing_sources = _source_lookup_by_canonical(db, seed)
    for link_id in link_ids:
        link = db.query(DiscoveredLink).filter(DiscoveredLink.id == link_id, DiscoveredLink.seed_id == seed.id).first()
        if link is None or link.status == "approved":
            continue
        link.url = canonicalize_monitored_url(link.url)
        existing = existing_sources.get(link.url)
        if existing:
            link.status = "approved"
            link.source_id = existing.id
            continue
        src = Source(
            tenant_id=seed.tenant_id, competitor_id=seed.competitor_id, url=link.url,
            source_type=source_type or _source_type_from_category(link.category),
            crawl_frequency_hours=crawl_frequency_hours,
            page_category=page_category or link.category, is_active=True,
        )
        db.add(src)
        db.flush()
        existing_sources[link.url] = src
        link.status = "approved"
        link.source_id = src.id
        created.append(src)
    db.flush()
    seed.pending_count = db.query(DiscoveredLink).filter(DiscoveredLink.seed_id == seed.id, DiscoveredLink.status == "pending").count()
    db.flush()
    return created


def finalize_seed_setup(db: Session, seed: DiscoverySeed, selected_ids: list[str],
                        crawl_frequency_hours: int = 48) -> dict:
    """Create Sources for ALL links: selected=is_active=True, others=is_active=False."""
    all_links = db.query(DiscoveredLink).filter(DiscoveredLink.seed_id == seed.id).all()
    selected_set = set(selected_ids)
    active_count = 0
    archived_count = 0
    existing_sources = _source_lookup_by_canonical(db, seed)
    for link in all_links:
        if link.status == "approved" and link.source_id:
            continue
        link.url = canonicalize_monitored_url(link.url)
        existing = existing_sources.get(link.url)
        is_active = link.id in selected_set
        if existing:
            existing.is_active = is_active
            link.status = "approved" if is_active else "archived"
            link.source_id = existing.id
        else:
            src = Source(
                tenant_id=seed.tenant_id, competitor_id=seed.competitor_id, url=link.url,
                source_type=_source_type_from_category(link.category),
                crawl_frequency_hours=crawl_frequency_hours,
                page_category=link.category, is_active=is_active,
            )
            db.add(src)
            db.flush()
            existing_sources[link.url] = src
            link.status = "approved" if is_active else "archived"
            link.source_id = src.id
        if is_active:
            active_count += 1
        else:
            archived_count += 1
    seed.pending_count = 0
    db.flush()
    return {"active": active_count, "archived": archived_count}


def reject_links(db: Session, seed: DiscoverySeed, link_ids: list[str]) -> int:
    count = 0
    for link_id in link_ids:
        link = db.query(DiscoveredLink).filter(DiscoveredLink.id == link_id, DiscoveredLink.seed_id == seed.id).first()
        if link and link.status == "pending":
            link.status = "rejected"
            count += 1
    db.flush()
    seed.pending_count = db.query(DiscoveredLink).filter(DiscoveredLink.seed_id == seed.id, DiscoveredLink.status == "pending").count()
    db.flush()
    return count


def _source_type_from_category(category: str) -> str:
    return {"san_pham": "course_catalog", "khuyen_mai": "landing_page", "other": "other"}.get(category, "other")
