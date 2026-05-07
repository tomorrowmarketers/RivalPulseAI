from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable


NOISE_PATTERNS = [
    re.compile(r"cookie", re.IGNORECASE),
    re.compile(r"privacy", re.IGNORECASE),
    re.compile(r"terms", re.IGNORECASE),
]


def normalize_text(value: str) -> str:
    text = value.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def filter_noise(blocks: Iterable[str]) -> list[str]:
    kept: list[str] = []
    for raw in blocks:
        block = normalize_text(raw)
        if not block:
            continue
        if len(block) < 8:
            continue
        if any(pattern.search(block) for pattern in NOISE_PATTERNS):
            continue
        kept.append(block)
    seen = set()
    unique_blocks: list[str] = []
    for block in kept:
        if block in seen:
            continue
        seen.add(block)
        unique_blocks.append(block)
    return unique_blocks
