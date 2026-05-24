from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from competitor_intel.config import settings
from competitor_intel.services.text_utils import filter_noise, hash_text, normalize_text
from competitor_intel.services.url_utils import canonicalize_monitored_url, is_noise_url


@dataclass(slots=True)
class CrawlResult:
    final_url: str
    http_status: int
    page_title: str | None
    h1: str | None
    meta_description: str | None
    canonical_url: str | None
    raw_html: str
    extracted_text: str
    extracted_blocks: list[str]
    extracted_links: list[dict[str, str]]
    content_hash: str
    metadata_json: dict


def fetch_page(url: str) -> CrawlResult:
    headers = {"User-Agent": settings.crawl_user_agent}
    timeout = httpx.Timeout(settings.crawl_timeout_seconds)
    with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
        response = client.get(url)
        response.raise_for_status()
        html = response.text

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    title = normalize_text(soup.title.text) if soup.title and soup.title.text else None
    h1_tag = soup.find("h1")
    h1 = normalize_text(h1_tag.get_text(" ")) if h1_tag else None
    meta = soup.find("meta", attrs={"name": "description"})
    meta_description = normalize_text(meta.get("content", "")) if meta and meta.get("content") else None
    canonical = soup.find("link", attrs={"rel": "canonical"})
    canonical_url = (
        canonicalize_monitored_url(urljoin(str(response.url), canonical.get("href")))
        if canonical and canonical.get("href")
        else None
    )

    blocks: list[str] = []
    for node in soup.find_all(["h1", "h2", "h3", "p", "li", "button", "a"]):
        text = normalize_text(node.get_text(" "))
        if text:
            blocks.append(text)
    filtered_blocks = filter_noise(blocks)
    extracted_text = "\n".join(filtered_blocks)

    links = []
    for anchor in soup.find_all("a", href=True):
        text = normalize_text(anchor.get_text(" "))
        href = canonicalize_monitored_url(urljoin(str(response.url), anchor["href"]))
        if href:
            links.append({"text": text, "href": href})

    metadata_json = {
        "headings": [normalize_text(item.get_text(" ")) for item in soup.find_all(["h1", "h2", "h3"]) if normalize_text(item.get_text(" "))],
        "buttons": [normalize_text(item.get_text(" ")) for item in soup.find_all(["button"]) if normalize_text(item.get_text(" "))],
    }

    return CrawlResult(
        final_url=str(response.url),
        http_status=response.status_code,
        page_title=title,
        h1=h1,
        meta_description=meta_description,
        canonical_url=canonical_url,
        raw_html=html,
        extracted_text=extracted_text,
        extracted_blocks=filtered_blocks,
        extracted_links=links,
        content_hash=hash_text(extracted_text),
        metadata_json=metadata_json,
    )


@dataclass
class PageInfo:
    url: str
    link_text: str
    page_title: str | None
    meta_description: str | None
    discovered_links: list[dict[str, str]] = field(default_factory=list)


def _fetch_page_info(url: str, link_text: str) -> tuple["PageInfo | None", list[dict[str, str]]]:
    """Lightweight fetch - returns PageInfo + list of internal links."""
    headers = {"User-Agent": settings.crawl_user_agent}
    timeout = httpx.Timeout(settings.discovery_timeout_seconds)

    def _strip_www(netloc: str) -> str:
        return netloc.lower().removeprefix("www.")

    try:
        with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
            response = client.get(url)
            if response.status_code >= 400:
                return None, []
            html = response.text
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        title = normalize_text(soup.title.text) if soup.title and soup.title.text else None
        meta = soup.find("meta", attrs={"name": "description"})
        meta_desc = normalize_text(meta.get("content", "")) if meta and meta.get("content") else None
        effective_host = _strip_www(urlparse(str(response.url)).netloc)
        links: list[dict[str, str]] = []
        for a in soup.find_all("a", href=True):
            raw_href = (a.get("href") or "").strip()
            if not raw_href or raw_href.lower().startswith(("mailto:", "tel:", "javascript:")):
                continue
            href = canonicalize_monitored_url(urljoin(str(response.url), raw_href))
            parsed = urlparse(href)
            if parsed.scheme not in ("http", "https"):
                continue
            if _strip_www(parsed.netloc) != effective_host:
                continue
            text = normalize_text(a.get_text(" ")) or ""
            links.append({"url": href, "text": text})
        info = PageInfo(
            url=canonicalize_monitored_url(str(response.url)),
            link_text=link_text,
            page_title=title,
            meta_description=meta_desc,
        )
        return info, links
    except Exception:
        return None, []


def deep_discover_pages(
    seed_url: str,
    max_pages: int | None = None,
    progress: Callable[[str], None] | None = None,
) -> list["PageInfo"]:
    """BFS from *seed_url* and follow internal links until the frontier is exhausted.

    Pass a positive *max_pages* to cap the crawl. None/0 means no page-count cap.
    Pages are fetched concurrently in batches controlled by DISCOVERY_BATCH_SIZE.
    """
    normalized_seed_url = canonicalize_monitored_url(seed_url)
    base_host = urlparse(normalized_seed_url).netloc.lower().removeprefix("www.")
    page_limit = max_pages if max_pages and max_pages > 0 else None
    batch_size = max(1, settings.discovery_batch_size)

    def _strip_www(netloc: str) -> str:
        return netloc.lower().removeprefix("www.")

    def _norm(u: str) -> str:
        c = canonicalize_monitored_url(u)
        p = urlparse(c)
        if p.netloc.startswith("www."):
            c = c.replace(f"://{p.netloc}", f"://{p.netloc[4:]}", 1)
        return c

    def _is_internal(href: str) -> bool:
        p = urlparse(href)
        return (
            p.scheme in ("http", "https", "")
            and (not p.netloc or _strip_www(p.netloc) == base_host)
            and not href.lower().startswith(("mailto:", "tel:", "javascript:"))
        )

    visited: set[str] = {_norm(normalized_seed_url)}
    queue: list[tuple[str, str]] = [(normalized_seed_url, "")]
    results: list[PageInfo] = []
    batch_index = 0

    while queue and (page_limit is None or len(results) < page_limit):
        current_batch_size = batch_size
        if page_limit is not None:
            remaining = page_limit - len(results)
            if remaining <= 0:
                break
            current_batch_size = min(current_batch_size, remaining)

        batch: list[tuple[str, str]] = []
        while queue and len(batch) < current_batch_size:
            batch.append(queue.pop(0))
        if not batch:
            break

        batch_index += 1
        if progress:
            progress(f"Đang mở nhóm trang {batch_index} và tìm thêm liên kết nội bộ")

        with ThreadPoolExecutor(max_workers=current_batch_size) as executor:
            futures = {executor.submit(_fetch_page_info, u, t): (u, t) for u, t in batch}
            for future in as_completed(futures):
                try:
                    info, new_links = future.result()
                    if info and (page_limit is None or len(results) < page_limit):
                        results.append(info)
                        if progress:
                            label = info.page_title or info.url
                            progress(f"Đã đọc {len(results)} trang: {label}")
                    for lnk in new_links:
                        href = lnk["url"]
                        norm = _norm(href)
                        if norm in visited or not _is_internal(href) or is_noise_url(href):
                            continue
                        visited.add(norm)
                        if page_limit is None or len(results) + len(queue) < page_limit * 3:
                            queue.append((href, lnk["text"]))
                except Exception:
                    pass

    seen_final: set[str] = set()
    deduped: list[PageInfo] = []
    for r in results:
        norm = _norm(r.url)
        if norm not in seen_final:
            seen_final.add(norm)
            deduped.append(r)
    if progress:
        progress(f"Đã gom {len(deduped)} trang duy nhất từ domain")
    return deduped if page_limit is None else deduped[:page_limit]


def discover_links(seed_url: str, include_pattern: str | None = None) -> list[dict[str, str]]:
    """Fetch *seed_url* and return deduplicated internal links.

    Links are filtered to the same domain as seed_url.  If *include_pattern*
    is supplied it is treated as a regex applied to the full href; only
    matching links are returned.
    """
    result = fetch_page(seed_url)
    base_domain = urlparse(seed_url).netloc

    seen: set[str] = set()
    discovered: list[dict[str, str]] = []

    for link in result.extracted_links:
        href = link.get("href", "")
        if not href:
            continue
        # skip non-navigable schemes
        if href.lower().startswith(("mailto:", "tel:", "javascript:")):
            continue
        parsed = urlparse(href)
        # keep only same-domain links
        if parsed.netloc and parsed.netloc != base_domain:
            continue
        if parsed.scheme and parsed.scheme not in ("http", "https", ""):
            continue
        # apply optional include pattern
        if include_pattern:
            try:
                if not re.search(include_pattern, href):
                    continue
            except re.error:
                pass  # invalid regex — skip filtering
        # normalise for deduplication (strip fragment, trailing slash)
        normalized = canonicalize_monitored_url(href)
        if normalized in seen:
            continue
        seen.add(normalized)
        discovered.append({"url": normalized, "text": link.get("text", "")})

    return discovered
