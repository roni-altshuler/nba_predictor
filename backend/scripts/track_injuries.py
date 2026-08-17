"""Record who is unavailable, every day, as an append-only transition log.

    python3 -m backend.scripts.track_injuries
    python3 -m backend.scripts.track_injuries --dry-run

Writes `backend/data/history/injury_log.json`.

**ESPN publishes injuries as a snapshot of today and keeps no history.** That
single fact is why this project shows availability on a game page and refuses
to let it touch a probability: an availability-adjusted rating cannot be
walk-forward tested against a corpus that does not exist, and this project
does not publish a number it cannot benchmark.

This script is the only thing that can ever change that. It cannot recover
the past — nobody can — but from today forward it accumulates the dataset
that closes the largest known gap in the model. **Every day it does not run
is a day that can never be recovered**, which is the same property that makes
`forecast_log.json` necessary and is the reason this is worth doing long
before there is anything to do with the result.

Two seasons from now this file supports a real question: does knowing who is
out improve a forecast, measured the same way everything else here is
measured? Until then it is a log that costs a few kilobytes a week.

Why a TRANSITION log rather than a daily snapshot
-------------------------------------------------
A full snapshot is roughly 27KB a day — 10MB a season, committed to git every
morning, almost all of it identical to yesterday. A player's status changes
a handful of times per injury.

So a row is written only when a player's state actually **changes**, and the
row carries the date it was observed. Replaying the log forward reconstructs
any team's availability on any past date exactly, which is precisely what a
backtest needs, at a few hundred rows a season instead of a few hundred
thousand.

The cost of that choice is stated rather than hidden: **the log records when
this pipeline first SAW a change, not when the change happened.** A status
that flips and flips back between two runs is invisible, and a report
published six hours before tip-off is recorded as of the next morning's run.
Anything built on this must treat the observation date as the fact, not the
injury date, or it will read the future.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("track_injuries")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "backend" / "data" / "history" / "injury_log.json"

# `/injuries`, NOT `/teams/injuries` — the latter answers 400 for every
# request. The frontend shipped with that mistake and, because every ESPN
# reader there fails soft, it reported "no injury report" forever instead of
# erroring. Same host rule as everywhere else: `site.web.api`, never
# `site.api`, which 403s datacentre IPs.
INJURIES_URL = (
    "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
)

TIMEOUT_SECONDS = 20


def fetch(url: str = INJURIES_URL) -> Optional[Dict]:
    """The current league-wide injury report, or None.

    None is a real, reportable state and the caller writes nothing on it. A
    day with no observation is a gap in the log; a day with an INVENTED
    observation is a corrupt log, and only one of those is recoverable.
    """
    # httpx, like the rest of the project's ESPN access: it honours the
    # proxy configuration the runner may set, which urllib picked up
    # inconsistently, and it is already a dependency.
    try:
        response = httpx.get(
            url,
            timeout=TIMEOUT_SECONDS,
            headers={"Accept": "application/json", "User-Agent": "hardwood/1.0"},
            follow_redirects=True,
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
        logger.error("could not read the injury report: %s", exc)
        return None


def parse(payload: Dict) -> Dict[Tuple[str, str], Dict]:
    """Flatten ESPN's response into `{(team, player): state}`.

    Keyed on the pair because a player traded mid-season appears under a new
    team and that IS a state change worth a row — the same name under a
    different franchise is not the same availability fact.
    """
    out: Dict[Tuple[str, str], Dict] = {}
    for block in (payload or {}).get("injuries") or []:
        team = block.get("displayName")
        if not team:
            continue
        for entry in block.get("injuries") or []:
            player = (entry.get("athlete") or {}).get("displayName")
            status = entry.get("status")
            if not player or not status:
                continue
            details = entry.get("details") or {}
            out[(str(team), str(player))] = {
                "team": str(team),
                "player": str(player),
                "position": ((entry.get("athlete") or {}).get("position") or {}).get(
                    "abbreviation"
                ),
                "status": str(status),
                "detail": _describe(details),
                "return_date": details.get("returnDate"),
                # ESPN's own timestamp for the report. Kept ALONGSIDE the
                # observation date, never instead of it: it is the only clue
                # about when a change actually happened, and it is also the
                # field that would let a careless backtest read the future.
                "espn_date": entry.get("date"),
            }
    return out


def _describe(details: Dict) -> Optional[str]:
    """Assemble "Left ankle sprain" from ESPN's separate fields.

    ESPN fills unknown parts with the literal string "Not Specified", which
    concatenates into "Right achilles not specified" — worse than saying
    nothing, because it reads as a diagnosis. Those tokens are dropped, and
    if nothing informative survives the caller gets None and renders no
    detail at all.
    """
    parts = [details.get("side"), details.get("type"), details.get("detail")]
    words = [
        str(p).strip()
        for p in parts
        if isinstance(p, str) and p.strip().lower() not in _UNINFORMATIVE
    ]
    if not words:
        return None
    phrase = " ".join(words)
    return phrase[0].upper() + phrase[1:].lower()


# Placeholders ESPN uses where it has no information. "" is in here because
# an empty string is the same absence spelled differently.
_UNINFORMATIVE = frozenset({"", "not specified", "unspecified", "n/a", "none"})


def latest_state(log: Sequence[Dict]) -> Dict[Tuple[str, str], Dict]:
    """The most recent recorded state per (team, player).

    Walks the whole log rather than reading a cached tail: the log is small
    by construction and a cached summary is one more thing that can disagree
    with the rows it summarises.
    """
    state: Dict[Tuple[str, str], Dict] = {}
    for row in log:
        state[(row["team"], row["player"])] = row
    return state


def _comparable(row: Dict) -> Tuple:
    """The fields that make two observations the same availability fact.

    `observed_at` is excluded, obviously. **`espn_date` is excluded too**, and
    that is deliberate: ESPN restamps a report when it re-publishes it
    unchanged, so including it would write a row every morning for a player
    whose situation has not moved — which is exactly the daily-snapshot cost
    this format exists to avoid.
    """
    return (row["status"], row.get("detail"), row.get("return_date"))


def diff(
    current: Dict[Tuple[str, str], Dict],
    previous: Dict[Tuple[str, str], Dict],
    observed_at: str,
) -> List[Dict]:
    """Rows to append: everything new, changed, or newly cleared."""
    rows: List[Dict] = []

    for key, entry in sorted(current.items()):
        before = previous.get(key)
        if before is not None and _comparable(before) == _comparable(entry):
            continue
        rows.append({**entry, "observed_at": observed_at})

    # A player who drops off the report has been cleared to play, and that is
    # as much a change as being ruled out. Without this the log can say a
    # player was Out in November and never say he came back.
    for key, before in sorted(previous.items()):
        if key in current or before["status"] == "Available":
            continue
        rows.append({
            "team": before["team"],
            "player": before["player"],
            "position": before.get("position"),
            "status": "Available",
            "detail": None,
            "return_date": None,
            "espn_date": None,
            "observed_at": observed_at,
        })

    return rows


def load(path: Path) -> Dict:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def publish(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, suffix=".tmp"
    )
    try:
        json.dump(payload, handle, indent=1)
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, path)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(OUT_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    payload = fetch()
    if payload is None:
        # Exit 0. A missed observation is a gap in a log, not a broken
        # pipeline, and failing the daily job over an ESPN hiccup would stop
        # the forecast — which is a strictly worse outcome than one thin day
        # in a dataset whose whole value is that it keeps accumulating.
        logger.warning("no observation recorded today")
        return 0

    current = parse(payload)
    if not current:
        logger.warning(
            "the report parsed to zero players — recording nothing rather "
            "than logging the entire league as newly available"
        )
        return 0

    path = Path(args.out)
    existing = load(path)
    rows: List[Dict] = existing.get("rows") or []
    observed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    new_rows = diff(current, latest_state(rows), observed_at)
    logger.info(
        "%d players on the report, %d state changes since the last run",
        len(current),
        len(new_rows),
    )

    if args.dry_run:
        for row in new_rows[:20]:
            logger.info(
                "  %s %s: %s%s",
                row["team"], row["player"], row["status"],
                f" ({row['detail']})" if row.get("detail") else "",
            )
        return 0

    if not new_rows:
        logger.info("nothing changed; the log is untouched")
        return 0

    rows.extend(new_rows)
    publish(path, {
        "note": (
            "Append-only transition log of NBA availability. A row is written "
            "when a player's status changes, not every day, and `observed_at` "
            "is when THIS PIPELINE saw the change rather than when it "
            "happened. Anything scored against this must key on observed_at "
            "or it will read the future. ESPN keeps no injury history; this "
            "file is the only record of it that will exist."
        ),
        "source": INJURIES_URL,
        "first_observed": rows[0]["observed_at"] if rows else None,
        "last_observed": observed_at,
        "n_rows": len(rows),
        "rows": rows,
    })
    logger.info("wrote %s (%d rows total)", path, len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
