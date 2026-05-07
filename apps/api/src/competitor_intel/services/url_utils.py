from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "mkt_tok",
    "srsltid",
    "_ga",
    "_gl",
    "marketing_project",
}


def _is_tracking_query_param(name: str) -> bool:
    lowered = name.strip().lower()
    return lowered.startswith("utm_") or lowered in _TRACKING_QUERY_KEYS


def canonicalize_monitored_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return raw

    parts = urlsplit(raw)
    if not parts.scheme and not parts.netloc:
        without_fragment = raw.split("#", 1)[0]
        if without_fragment in {"", "/"}:
            return without_fragment
        return without_fragment.rstrip("/")

    path = parts.path or ""
    if path == "/":
        path = ""
    elif path:
        path = path.rstrip("/")

    filtered_query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not _is_tracking_query_param(key)
    ]
    query = urlencode(sorted(filtered_query), doseq=True)

    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))


# ---------------------------------------------------------------------------
# Noise URL detection — URLs not worth crawling or monitoring
# ---------------------------------------------------------------------------

_NOISE_PATTERNS: list[str] = [
    # Static assets (images, fonts, media)
    r"\.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot|mp4|mp3|pdf|zip|css|js)(\?|$)",
    # WordPress uploads
    r"/wp-content/uploads/",
    # Pagination (/page/2, /blog/page/3, /shop/page/N)
    r"/page/\d+",
    # Author / individual profile pages
    r"/author/",
    r"/lecturer/[^/]+/?$",   # individual lecturer page (not list /lecturer)
    r"/student-post/",
    r"/testimonial/[^/]+/?$",  # individual testimonial page
    # Taxonomy archives
    r"/tag/",
    r"/blog/categories/",
    # Account / cart / auth
    r"/my-account",
    r"/cart/?$",
    r"/login/?$",
    r"/dang-ky-tai-khoan",
    # Legal / policy
    r"/chinh-sach-",
    r"/quy-dinh-",
    r"/dieu-khoan-",
    r"/(privacy|terms|legal)(/|$)",
    # Low-value utility pages
    r"/newsletter/?$",
    r"/groups/?$",
    r"/verification/?$",
    r"/sharing/?$",
    r"/hop-tac-tuyen-dung",
    r"/lost-password",
]

_NOISE_RE = re.compile("|".join(_NOISE_PATTERNS), re.IGNORECASE)


def is_noise_url(url: str) -> bool:
    """Return True if *url* is structural noise not worth crawling or monitoring.

    Covers: pagination, author/profile pages, tag/category archives,
    account/cart pages, legal pages, and other low-value utility pages.
    """
    return bool(_NOISE_RE.search(url or ""))