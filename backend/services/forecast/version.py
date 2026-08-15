"""Model version — a human half and a hash half.

`2026.08.1` is human-facing and bumped deliberately. `+a1b2c3d4` is a hash of
the configuration that *determines* a forecast: the feature list, the Elo
settings, the shock size, the simulation count, the season scope.

The split exists because a release string someone must remember to bump
fails silently — two different models ship under one label and the
evaluation record quietly mixes them. The hash cannot fail that way.

`test_version.py` pins the property that makes it useful: **reordering the
feature list is not a change, adding a feature is.** A hash over a raw dict
repr would flip on cosmetic edits and stop meaning anything.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict

RELEASE = "2026.08.1"


def config_hash(config: Dict[str, Any]) -> str:
    """Stable 8-character hash of a forecast-determining configuration.

    Sorted keys and sorted sequence members, so the hash answers "is this
    the same model?" rather than "is this the same Python literal?".
    """
    canonical = json.dumps(_canonicalise(config), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:8]


def _canonicalise(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _canonicalise(v) for k, v in sorted(value.items())}
    if isinstance(value, (list, tuple, set)):
        return sorted(
            (_canonicalise(v) for v in value),
            key=lambda item: json.dumps(item, sort_keys=True, default=str),
        )
    if isinstance(value, float):
        # Round so that 0.1 + 0.2 and 0.3 are the same configuration.
        return round(value, 10)
    return value


def model_version(config: Dict[str, Any]) -> str:
    return f"{RELEASE}+{config_hash(config)}"
