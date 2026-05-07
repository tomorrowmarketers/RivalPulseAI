from __future__ import annotations

from datetime import UTC, datetime

from competitor_intel.config import settings
from competitor_intel.storage import write_json


def write_notification(kind: str, payload: dict) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    relative_path = f"{kind}/{stamp}.json"
    return write_json(relative_path, payload, root=settings.outbox_root)
