"""Ingestion observations, separate from forecast generation timestamps."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STATUS_PATH = Path(__file__).resolve().parents[2] / "data/diagnostics/ingestion_status.json"


def read_status(path: Path = STATUS_PATH) -> dict:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"status": "unknown", "last_success_at": None}
    if not isinstance(data, dict):
        return {"status": "unknown", "last_success_at": None}
    return data


def record_status(
    path: Path, *, seasons: list[int], status: str,
    event_count: int | None, error: str | None = None,
    stats: dict[str, Any] | None = None,
) -> dict:
    previous = read_status(path)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {
        "source": "espn",
        "status": status,
        "attempted_at": now,
        "seasons": seasons,
        "last_success_at": now if status == "ok" else (
            previous.get("last_success_at") if previous.get("seasons") == seasons else None
        ),
        "event_count": event_count,
        "warehouse_updated": status == "ok",
        "error": error,
        "stats": stats,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(path)
    return payload
