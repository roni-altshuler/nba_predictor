"""Explicit ESPN bracket-slot names, shared by validation and ingestion."""

from __future__ import annotations

import re
from typing import Any, Optional


_PLACEHOLDER_NAMES = {
    "tbd", "tba", "to be determined", "to be announced", "bye",
    "winner", "loser", "team tbd",
}
_PLACEHOLDER_RE = re.compile(
    r"^(tbd|tba|bye)$|winner of|loser of|\d(st|nd|rd|th)\s+place|"
    r"group\s+[a-h]\s|seed\s+\d",
    re.IGNORECASE,
)


def is_placeholder(name: Optional[str]) -> bool:
    """True when a competitor is a bracket slot rather than a franchise."""
    if not name:
        return True
    text = str(name).strip()
    if text.lower() in _PLACEHOLDER_NAMES:
        return True
    return bool(_PLACEHOLDER_RE.search(text))


def is_placeholder_team(team: Any) -> bool:
    """Require an explicit slot name; missing team metadata is not evidence."""
    return isinstance(team, dict) and any(
        isinstance(team.get(field), str) and team[field] and is_placeholder(team[field])
        for field in ("displayName", "name", "abbreviation")
    )
