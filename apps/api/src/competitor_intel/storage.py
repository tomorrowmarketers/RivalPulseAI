from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from competitor_intel.config import settings


def ensure_storage_roots() -> None:
    for path in (settings.storage_root, settings.reports_root, settings.outbox_root):
        path.mkdir(parents=True, exist_ok=True)


def write_text(relative_path: str, content: str, root: Path | None = None) -> str:
    base = root or settings.storage_root
    target = base / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return str(target)


def write_json(relative_path: str, payload: dict[str, Any], root: Path | None = None) -> str:
    base = root or settings.storage_root
    target = base / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(target)
