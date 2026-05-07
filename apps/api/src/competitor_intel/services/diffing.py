from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher


PRICE_PATTERN = re.compile(r"((?:\d{1,3}[.,]?)+(?:\s?)(?:vnđ|vnd|đ|\$))", re.IGNORECASE)
PERCENT_PATTERN = re.compile(r"\b\d{1,3}\s?%")
DATE_PATTERN = re.compile(r"\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b")


@dataclass(slots=True)
class DiffResult:
    added_blocks: list[str]
    removed_blocks: list[str]
    changed_headings: list[str]
    changed_ctas: list[str]
    extracted_entities: dict
    noise_score: float
    diff_status: str


def _list_delta(previous: list[str], current: list[str]) -> tuple[list[str], list[str]]:
    previous_set = set(previous)
    current_set = set(current)
    added = [item for item in current if item not in previous_set]
    removed = [item for item in previous if item not in current_set]
    return added[:25], removed[:25]


def _extract_entities(blocks: list[str]) -> dict:
    joined = "\n".join(blocks)
    return {
        "prices": PRICE_PATTERN.findall(joined),
        "percentages": PERCENT_PATTERN.findall(joined),
        "dates": DATE_PATTERN.findall(joined),
    }


def build_diff(
    previous_blocks: list[str],
    current_blocks: list[str],
    previous_headings: list[str],
    current_headings: list[str],
    previous_ctas: list[str],
    current_ctas: list[str],
) -> DiffResult:
    added_blocks, removed_blocks = _list_delta(previous_blocks, current_blocks)
    changed_headings, _ = _list_delta(previous_headings, current_headings)
    changed_ctas, _ = _list_delta(previous_ctas, current_ctas)

    previous_joined = "\n".join(previous_blocks)
    current_joined = "\n".join(current_blocks)
    similarity = SequenceMatcher(None, previous_joined, current_joined).ratio() if previous_joined or current_joined else 1.0
    noise_score = round(1 - similarity, 4)

    diff_blocks = added_blocks + removed_blocks + changed_headings + changed_ctas
    diff_status = "ignored_noise" if noise_score < 0.02 and len(diff_blocks) <= 2 else "detected"

    return DiffResult(
        added_blocks=added_blocks,
        removed_blocks=removed_blocks,
        changed_headings=changed_headings,
        changed_ctas=changed_ctas,
        extracted_entities=_extract_entities(diff_blocks),
        noise_score=noise_score,
        diff_status=diff_status,
    )
