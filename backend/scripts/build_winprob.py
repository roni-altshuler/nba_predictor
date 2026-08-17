"""Ingest play-by-play into the compact state a live win-probability model needs.

    python3 -m backend.scripts.build_winprob --seasons 2026
    python3 -m backend.scripts.build_winprob --seasons 2024-2026 --limit 200

Writes into the warehouse table `game_states`.

**Four integers per play, not the play.** ESPN's `plays` block is ~484 rows a
game carrying shot coordinates, participant ids, and free text; thirty
thousand games of that is gigabytes and no forecast reads a word of it. What
a live win-probability model consumes is the game STATE at each moment:
seconds left, score difference, and who eventually won. That is small enough
to keep and is the only part that is model input rather than colour.

This is the same rule that keeps player box scores out of the warehouse,
applied in the other direction: player lines are not model input and stay
out, game states ARE model input and come in.

Scope
-----
Seasons are ingested on demand rather than all at once, because this is one
HTTP request per game against a public API — at a courteous rate a season is
about twenty minutes. The model is fitted on whatever is present and the
benchmark reports the corpus it used, so a partial ingest produces a smaller
honest number rather than a broken one.

**Ordering is not assumed.** ESPN publishes plays in sequence but the field
is a string on some payloads and an int on others, and one out-of-order row
would put a fourth-quarter state in the first quarter for the model. Rows are
sorted on the clock this script derives, and a row whose clock cannot be
derived is dropped rather than guessed at.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

import httpx

from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("build_winprob")

SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
SCORED_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)

REGULATION_PERIODS = 4
PERIOD_SECONDS = 12 * 60
OVERTIME_SECONDS = 5 * 60

# One request per game against somebody else's public API. A second between
# them is slower than necessary and is the right kind of rude to avoid.
REQUEST_DELAY = 1.0
TIMEOUT = 20.0


def seconds_remaining(period: int, clock: str) -> Optional[float]:
    """Seconds left in REGULATION, which can be negative in overtime.

    Negative rather than clamped, deliberately. A model fitted on
    `time_remaining >= 0` has no way to express "this is overtime, the score
    is level and there are two minutes left", and clamping to zero would
    stack every overtime moment on the same point as the final buzzer.
    """
    try:
        minutes, seconds = str(clock).split(":")
        left_in_period = int(minutes) * 60 + int(seconds)
    except (ValueError, AttributeError):
        return None
    if period <= REGULATION_PERIODS:
        return float(left_in_period + (REGULATION_PERIODS - period) * PERIOD_SECONDS)
    # Overtime: regulation is over, so time remaining is negative and counts
    # further down with each extra period.
    elapsed_ot = (period - REGULATION_PERIODS - 1) * OVERTIME_SECONDS
    return float(-(elapsed_ot + (OVERTIME_SECONDS - left_in_period)))


def parse_states(payload: Dict) -> List[Tuple[float, int, int, int]]:
    """`(seconds_remaining, score_diff, period, home_score)` per play.

    Deduplicated on the clock: a rebound and the shot before it often share a
    timestamp and a score, and keeping both weights that instant twice.
    """
    plays = (payload or {}).get("plays")
    if not isinstance(plays, list):
        return []

    seen: Dict[Tuple[float, int], Tuple[float, int, int, int]] = {}
    for play in plays:
        period = ((play or {}).get("period") or {}).get("number")
        clock = ((play or {}).get("clock") or {}).get("displayValue")
        home = play.get("homeScore")
        away = play.get("awayScore")
        if period is None or clock is None or home is None or away is None:
            continue
        try:
            period = int(period)
            home, away = int(home), int(away)
        except (TypeError, ValueError):
            continue
        left = seconds_remaining(period, clock)
        if left is None:
            continue
        diff = home - away
        seen[(left, diff)] = (left, diff, period, home)

    # Sorted on the derived clock, never on ESPN's sequence field: that field
    # is a string on some payloads and an integer on others, and a lexical
    # sort puts play 10 before play 9.
    return sorted(seen.values(), key=lambda row: -row[0])


def fetch(client: httpx.Client, game_id: str) -> Optional[Dict]:
    try:
        response = client.get(SUMMARY, params={"event": game_id}, timeout=TIMEOUT)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("game %s unavailable: %s", game_id, exc)
        return None


DDL = """
CREATE TABLE IF NOT EXISTS game_states (
    game_id TEXT NOT NULL,
    seconds_remaining REAL NOT NULL,
    score_diff INTEGER NOT NULL,
    period INTEGER NOT NULL,
    home_score INTEGER NOT NULL,
    home_won INTEGER NOT NULL,
    season INTEGER NOT NULL,
    PRIMARY KEY (game_id, seconds_remaining, score_diff)
)
"""
INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_states_season ON game_states(season)"
)


def ensure_table(warehouse) -> None:
    with warehouse.transaction() as conn:
        conn.execute(DDL)
        conn.execute(INDEX)


def already_ingested(warehouse) -> set:
    try:
        return {
            str(r["game_id"])
            for r in warehouse.conn.execute("SELECT DISTINCT game_id FROM game_states")
        }
    except Exception:  # noqa: BLE001 - table may not exist yet
        return set()


def games_to_fetch(
    warehouse, seasons: Sequence[int], limit: Optional[int]
) -> List[Tuple[str, int, bool]]:
    done = already_ingested(warehouse)
    out: List[Tuple[str, int, bool]] = []
    for row in warehouse.iter_games(seasons=list(seasons), season_types=SCORED_TYPES):
        game_id = str(row["game_id"])
        if game_id in done:
            continue
        out.append((
            game_id,
            int(row["season"]),
            int(row["home_score"]) > int(row["away_score"]),
        ))
        if limit and len(out) >= limit:
            break
    return out


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", default="2026",
                        help="e.g. 2026 or 2024-2026")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY)
    args = parser.parse_args(argv)

    if "-" in args.seasons:
        lo, hi = args.seasons.split("-")
        seasons = list(range(int(lo), int(hi) + 1))
    else:
        seasons = [int(args.seasons)]

    warehouse = get_warehouse()
    ensure_table(warehouse)

    pending = games_to_fetch(warehouse, seasons, args.limit)
    logger.info("%d games to fetch across seasons %s", len(pending), seasons)
    if not pending:
        logger.info("nothing to do")
        return 0

    ingested = 0
    empty = 0
    rows_written = 0
    with httpx.Client(headers={"Accept": "application/json"}) as client:
        for i, (game_id, season, home_won) in enumerate(pending, start=1):
            payload = fetch(client, game_id)
            states = parse_states(payload) if payload else []
            if not states:
                # ESPN carries no play-by-play for a good deal of the older
                # archive. Recorded as a count rather than a warning per game:
                # a corpus with a known hole is fine, and 1,300 warnings is
                # not information.
                empty += 1
            else:
                with warehouse.transaction() as conn:
                    conn.executemany(
                        "INSERT OR REPLACE INTO game_states (game_id, "
                        "seconds_remaining, score_diff, period, home_score, "
                        "home_won, season) VALUES (?,?,?,?,?,?,?)",
                        [
                            (game_id, left, diff, period, home,
                             1 if home_won else 0, season)
                            for left, diff, period, home in states
                        ],
                    )
                rows_written += len(states)
                ingested += 1
            if i % 50 == 0:
                logger.info(
                    "  %d/%d — %d with plays, %d without, %d states",
                    i, len(pending), ingested, empty, rows_written,
                )
            time.sleep(args.delay)

    logger.info(
        "done: %d games ingested, %d had no play-by-play, %d states written",
        ingested, empty, rows_written,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
