"""Durable forecast history: only absence is a legitimate empty record."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict


def utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('forecast timestamps must include a timezone')
    return parsed.astimezone(timezone.utc)


def read_history(path: Path) -> Dict:
    try:
        payload = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        raise ValueError(f'Cannot read forecast history {path}; refusing to replace or score an incomplete record') from exc
    if not isinstance(payload, dict) or not isinstance(payload.get('forecasts'), dict):
        raise ValueError(f'Invalid forecast history structure: {path}')
    if any(not isinstance(row, dict) for row in payload['forecasts'].values()):
        raise ValueError(f'Invalid forecast history entry: {path}')
    if 'n' in payload and payload['n'] != len(payload['forecasts']):
        raise ValueError(f'Forecast history count mismatch: {path}')
    return payload
