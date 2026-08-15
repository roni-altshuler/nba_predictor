"""The conference title race as a line, not a snapshot.

    python3 -m backend.scripts.title_race --track
    python3 -m backend.scripts.title_race --replay 2025 --every 14 --sims 4000

Two modes that write the same shape, and are labelled so a reader can always
tell which one they are looking at:

* ``--track`` appends TODAY's published projection to
  ``history/title_race_current.json``. Idempotent per Eastern day: running it
  twice replaces the day's point rather than doubling it, so a re-run after a
  failed deploy does not put a kink in the line. ``basis: "live"``.

* ``--replay SEASON`` reconstructs the whole arc of a completed season by
  re-simulating it from scratch at regular checkpoints, each using only games
  played strictly BEFORE that date. ``basis: "backtest"``.

**The replay is a reconstruction and the artifact says so on every record.**
The ratings at each checkpoint genuinely never saw the future — the corpus is
walked in order and snapshotted — but nobody read these numbers on those
dates either, and a line chart is unusually good at implying that somebody
did. The same discipline the game archive uses applies here.

**The replay does NOT call `regress_to_season`.** It is walking a corpus, so
the Elo system applies its season carryover lazily at the boundary, which is
the correct behaviour for a backtest and the opposite of what the live
forecaster needs. Calling it here would regress ratings a second time.

Margin sd is left at the simulator's measured default rather than refitting
the full margin model at every checkpoint: the model is refit monthly in the
benchmark and its sd moves in the third decimal, which is far below the
checkpoint-to-checkpoint movement this chart is about.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.ratings.elo import EloConfig, EloRatingSystem
from backend.services.simulation.season_simulator import SeasonSimulator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("title_race")

ROOT = Path(__file__).resolve().parent.parent.parent
HISTORY_DIR = ROOT / "backend" / "data" / "history"
PREDICTIONS_DIR = ROOT / "backend" / "data" / "predictions"

TRAIN_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)

# How many teams per conference the chart carries. Thirty lines is not a
# chart, it is a plaid; the rest fold into an explicit "field" series so the
# probabilities still sum to one and nothing is silently dropped.
TRACKED_PER_CONFERENCE = 6


def _eastern_day(iso: str) -> str:
    """The Eastern calendar day of a UTC timestamp.

    The NBA's day boundary is Eastern, not UTC — a 10:30pm Pacific tip-off is
    the same day's game and the next day's UTC timestamp. Bucketing on UTC
    put phantom back-to-backs in the integrity check the first time round.
    """
    when = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return (when - timedelta(hours=5)).date().isoformat()


def _publish(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)
    logger.info("wrote %s", path)


def _read(path: Path) -> Optional[Dict]:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


# --------------------------------------------------------------- tracking


def track(out_dir: Path) -> int:
    """Append the currently published projection as one point on the line."""
    projections = _read(PREDICTIONS_DIR / "season_projections.json")
    ratings = _read(PREDICTIONS_DIR / "power_ratings.json")
    if not projections or not ratings:
        logger.error(
            "no published projection to track — run forecast_season first"
        )
        return 1

    meta = {
        int(r["team_id"]): r for r in ratings.get("teams", [])
    }
    day = _eastern_day(projections["generated_at"])
    point = {
        "date": day,
        "generated_at": projections["generated_at"],
        "games_played": projections.get("games_played", 0),
        "model_version": projections.get("model_version"),
        "probabilities": {},
    }
    teams: Dict[str, Dict] = {}
    for team in projections.get("teams", []):
        info = meta.get(int(team["team_id"]))
        if not info:
            continue
        abbr = info["abbreviation"]
        point["probabilities"][abbr] = round(
            float(team.get("p_conference_title", 0.0)), 4
        )
        teams[abbr] = {
            "name": team.get("name"),
            "abbreviation": abbr,
            "conference": team.get("conference"),
            "logo": info.get("logo"),
        }

    path = out_dir / "title_race_current.json"
    existing = _read(path) or {}
    checkpoints = [
        c for c in existing.get("checkpoints", [])
        if c.get("date") != day
    ]
    # Same-season only. A new season starts a fresh line rather than
    # continuing last year's, which would draw a discontinuity as a trend.
    if existing.get("season") not in (None, projections["season"]):
        logger.info(
            "season changed %s → %s: starting a new line",
            existing.get("season"), projections["season"],
        )
        checkpoints = []
    checkpoints.append(point)
    checkpoints.sort(key=lambda c: c["date"])

    _publish(
        path,
        {
            "season": projections["season"],
            "basis": "live",
            "metric": "p_conference_title",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "tracked_per_conference": TRACKED_PER_CONFERENCE,
            "teams": {**(existing.get("teams") or {}), **teams},
            "checkpoints": checkpoints,
            "note": (
                "One point per day the forecast ran. These numbers were "
                "published in advance, unlike the season replays in the "
                "archive."
            ),
        },
    )
    logger.info("tracked %s — %d point(s) on the line", day, len(checkpoints))
    return 0


# ---------------------------------------------------------------- replay


def _franchises(warehouse) -> Dict[int, Dict]:
    return {
        int(r["team_id"]): {
            "name": r["display_name"],
            "abbreviation": r["abbreviation"],
            "conference": r["conference"],
            "logo": r["logo"],
        }
        for r in warehouse.conn.execute(
            "SELECT * FROM teams WHERE conference IS NOT NULL"
        )
    }


def _checkpoint_dates(
    first: str, last: str, every: int
) -> List[str]:
    """Checkpoint days across a season, inclusive of opening night."""
    start = datetime.fromisoformat(first.replace("Z", "+00:00"))
    end = datetime.fromisoformat(last.replace("Z", "+00:00"))
    out: List[str] = []
    cursor = start
    while cursor <= end:
        out.append(cursor.date().isoformat())
        cursor += timedelta(days=every)
    tail = end.date().isoformat()
    if out and out[-1] != tail:
        out.append(tail)
    return out


def replay(season: int, *, every: int, sims: int, out_dir: Path) -> int:
    """Re-simulate a completed season at checkpoints, walking forward."""
    warehouse = get_warehouse()
    franchises = _franchises(warehouse)

    season_games = [
        r
        for r in warehouse.iter_games(seasons=[season], season_types=(SEASON_TYPE_REGULAR,))
        if int(r["home_team_id"]) in franchises
        and int(r["away_team_id"]) in franchises
        and "cup championship" not in str(r["phase"] or "").lower()
    ]
    if len(season_games) < 500:
        logger.error(
            "season %s has only %d regular-season games — nothing to replay",
            season, len(season_games),
        )
        return 1

    dates = _checkpoint_dates(
        season_games[0]["date_utc"], season_games[-1]["date_utc"], every
    )
    logger.info(
        "season %s: %d games, %d checkpoints every %d days, %d sims each",
        season, len(season_games), len(dates), every, sims,
    )

    # ONE walk of the whole corpus, snapshotting ratings as each checkpoint
    # falls due. Re-running Elo from 2004 per checkpoint would be twenty
    # walks of thirty thousand games to produce the same twenty snapshots.
    elo = EloRatingSystem(EloConfig())
    snapshots: Dict[str, Dict[int, float]] = {}
    pending = list(dates)
    previous = ""
    for row in warehouse.iter_games(season_types=TRAIN_TYPES):
        date_utc = str(row["date_utc"])
        if date_utc < previous:
            raise ValueError("warehouse returned games out of order")
        previous = date_utc
        day = date_utc[:10]
        while pending and pending[0] <= day:
            snapshots[pending.pop(0)] = elo.snapshot()
        if (
            int(row["home_team_id"]) not in franchises
            or int(row["away_team_id"]) not in franchises
        ):
            continue
        elo.update(
            game_id=row["game_id"],
            date_utc=date_utc,
            season=int(row["season"]),
            home_team_id=int(row["home_team_id"]),
            away_team_id=int(row["away_team_id"]),
            home_score=int(row["home_score"]),
            away_score=int(row["away_score"]),
            neutral=bool(row["neutral_site"]),
        )
    for day in pending:
        snapshots[day] = elo.snapshot()

    simulator = SeasonSimulator(
        simulations=sims,
        home_advantage_elo=EloConfig().home_advantage,
    )

    checkpoints: List[Dict] = []
    for day in dates:
        ratings = snapshots.get(day) or {}
        standings: Dict[int, List[int]] = defaultdict(lambda: [0, 0])
        remaining: List[Tuple[int, int]] = []
        for row in season_games:
            home, away = int(row["home_team_id"]), int(row["away_team_id"])
            if str(row["date_utc"])[:10] < day:
                if row["home_score"] > row["away_score"]:
                    standings[home][0] += 1
                    standings[away][1] += 1
                else:
                    standings[away][0] += 1
                    standings[home][1] += 1
            else:
                remaining.append((home, away))

        teams_for_sim = {
            tid: {
                "name": info["name"],
                "conference": info["conference"],
                # A franchise with no rating yet has not played; the base
                # rating is the honest answer, not an exclusion that would
                # quietly shrink the conference below eight teams.
                "elo": ratings.get(tid, EloConfig().base_rating),
            }
            for tid, info in franchises.items()
        }
        result = simulator.simulate(
            season=season,
            teams=teams_for_sim,
            standings={k: (v[0], v[1]) for k, v in standings.items()},
            remaining=remaining,
            generated_at=day,
        )
        played = sum(v[0] + v[1] for v in standings.values()) // 2
        checkpoints.append(
            {
                "date": day,
                "games_played": played,
                "probabilities": {
                    franchises[t.team_id]["abbreviation"]: round(
                        t.p_conference_title, 4
                    )
                    for t in result.teams
                    if t.team_id in franchises
                },
            }
        )
        logger.info("  %s — %d games banked", day, played)

    champion = _champion(warehouse, season, franchises)
    _publish(
        out_dir / f"title_race_{season}.json",
        {
            "season": season,
            "basis": "backtest",
            "metric": "p_conference_title",
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "simulations": sims,
            "every_days": every,
            "tracked_per_conference": TRACKED_PER_CONFERENCE,
            "champion": champion,
            "teams": {
                info["abbreviation"]: {
                    "name": info["name"],
                    "abbreviation": info["abbreviation"],
                    "conference": info["conference"],
                    "logo": info["logo"],
                }
                for info in franchises.values()
            },
            "checkpoints": checkpoints,
            "note": (
                "A reconstruction. Ratings at each checkpoint were built from "
                "games strictly earlier than it, so the model never saw the "
                "future — but nobody read these numbers on those dates."
            ),
        },
    )
    return 0


def _champion(warehouse, season: int, franchises: Dict[int, Dict]) -> Optional[str]:
    """Whoever won the last postseason game of the season."""
    rows = [
        r
        for r in warehouse.iter_games(
            seasons=[season], season_types=(SEASON_TYPE_POSTSEASON,)
        )
    ]
    if not rows:
        return None
    last = rows[-1]
    winner = (
        int(last["home_team_id"])
        if last["home_score"] > last["away_score"]
        else int(last["away_team_id"])
    )
    return (franchises.get(winner) or {}).get("abbreviation")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--track", action="store_true")
    parser.add_argument("--replay", type=int, default=None)
    parser.add_argument("--every", type=int, default=14)
    parser.add_argument("--sims", type=int, default=4000)
    parser.add_argument("--out-dir", default=str(HISTORY_DIR))
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    if args.track:
        return track(out_dir)
    if args.replay:
        return replay(args.replay, every=args.every, sims=args.sims, out_dir=out_dir)
    parser.error("pass --track or --replay SEASON")
    return 2


if __name__ == "__main__":
    sys.exit(main())
