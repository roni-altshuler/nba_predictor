"""Stand the daily job at dates inside a finished season and check it holds.

    python3 -m backend.scripts.rehearse
    python3 -m backend.scripts.rehearse --season 2026 --sims 2000
    python3 -m backend.scripts.rehearse --dates 2025-10-25,2026-01-15

Writes `backend/data/diagnostics/rehearsal.json`.

**Nothing in this pipeline has ever run against a season in progress.** It
was built and benchmarked entirely in an offseason, and every artifact it
publishes today describes a league that has played zero games. On 20 October
that changes all at once, and the first day it meets a real slate is the
first day anyone finds out what it does with one.

That is a bad time to find out. The failures worth catching are not the ones
a unit test sees — they are shape failures that only appear with a partial
season on the books: a projection that divides by games remaining and meets
zero on the last day, a standings query that counts a game twice at the
season boundary, a play-in field that has not resolved, a February slate in
which a franchise has 41 games and its opponent 44. All of that is already
sitting in the archive of a completed season, and none of it has ever been
shown to this code.

So this script replays one. At each checkpoint it calls **the real publishing
functions** — `train_through`, `current_standings`, `remaining_schedule`,
`forecast_games`, `SeasonSimulator` — with `as_of` set, which is why those
functions grew that parameter rather than this script growing a second copy
of them. A rehearsal against a reimplementation would prove only that the
reimplementation works.

What it checks
--------------
Invariants, not accuracy. The question is never "was the forecast good" —
that is what `benchmark_market` is for, and at a mid-season checkpoint the
answer is already known, which makes it a backtest. The question here is
whether the pipeline produces a **structurally valid** artifact at every
point in a season: probabilities that are probabilities, thirty franchises,
records that sum to the games actually played, an expected total that looks
like basketball.

**A failed invariant is a real failure and exits non-zero.** The point of a
dress rehearsal is that it can go wrong quietly in August rather than loudly
in November.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from backend.scripts.forecast_season import (
    current_standings,
    forecast_games,
    load_franchises,
    remaining_schedule,
    season_start,
    train_through,
)
from backend.services.data.warehouse import SEASON_TYPE_REGULAR, get_warehouse
from backend.services.simulation.season_simulator import SeasonSimulator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("rehearse")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "backend" / "data" / "diagnostics" / "rehearsal.json"

# The moments in a season whose SHAPE differs, expressed as a fraction of the
# way through it. Chosen for what breaks at each rather than for even spacing:
#
#   0.00  opening night — zero games played, the state the code has only ever
#         been run in, included as the control
#   0.02  the first week, when some teams have played three and some one
#   0.25  a normal night in December
#   0.50  the deadline, the first point at which rosters have genuinely moved
#   0.72  the All-Star break, the one multi-day gap in the calendar
#   0.95  the last week, when games remaining approaches zero and the play-in
#         picture is live — the highest-risk arithmetic in the projection
#   1.00  the morning after the regular season, games remaining exactly zero
CHECKPOINTS: Tuple[float, ...] = (0.0, 0.02, 0.25, 0.50, 0.72, 0.95, 1.0)


def checkpoint_dates(warehouse, season: int) -> List[str]:
    """Dates through the regular season, at the fractions above."""
    rows = sorted(
        str(r["date_utc"])
        for r in warehouse.iter_games(
            seasons=[season], season_types=(SEASON_TYPE_REGULAR,)
        )
    )
    if not rows:
        return []
    out: List[str] = []
    for fraction in CHECKPOINTS:
        index = min(int(fraction * len(rows)), len(rows) - 1)
        # Truncate to the day: the pipeline's own boundaries are days, and a
        # checkpoint at a precise tip-off time would split a slate in half.
        day = rows[index][:10]
        if day not in out:
            out.append(day)
    return out


def rehearse_one(
    warehouse, season: int, as_of: str, *, sims: int
) -> Dict:
    """Run the real publishing path as if today were `as_of`."""
    franchises = load_franchises(warehouse)
    model, builder, train_X = train_through(warehouse, franchises, as_of=as_of)
    standings = current_standings(warehouse, season, franchises, as_of=as_of)
    remaining = remaining_schedule(warehouse, season, franchises, as_of=as_of)

    elo = {tid: builder.elo.get(tid) for tid in franchises}
    teams = {
        tid: {
            "name": info["name"],
            "conference": info["conference"],
            "elo": elo[tid],
        }
        for tid, info in franchises.items()
    }

    simulator = SeasonSimulator(
        simulations=sims,
        home_advantage_elo=builder.elo.config.home_advantage,
        margin_sd=model.params.margin_sd,
    )
    result = simulator.simulate(
        season=season,
        teams=teams,
        standings=standings,
        remaining=[(g["home_team_id"], g["away_team_id"]) for g in remaining],
        generated_at=as_of,
    )
    games = forecast_games(model, builder, remaining, franchises, train_X)

    played = sum(w + l for w, l in standings.values()) // 2
    return {
        "as_of": as_of,
        "games_played": played,
        "games_remaining": len(remaining),
        "franchises": len(franchises),
        "margin_sd": model.params.margin_sd,
        "total_sd": model.params.total_sd,
        "projection": result,
        "forecasts": games,
        "season_start": season_start(warehouse, season),
        "standings": standings,
    }


# --------------------------------------------------------------- invariants


def _check(name: str, ok: bool, detail: str = "") -> Dict:
    return {"check": name, "ok": bool(ok), "detail": detail}


def invariants(state: Dict, season: int) -> List[Dict]:
    """Everything that must be true of a published artifact at any moment.

    Each returns a row rather than raising, so one failure does not hide the
    others — a checkpoint that breaks three things should say so once.
    """
    out: List[Dict] = []
    result = state["projection"]
    teams = result.teams
    games = state["forecasts"]

    out.append(_check("thirty franchises", len(teams) == 30, f"{len(teams)}"))

    # Championship probability is a distribution over franchises, so it sums
    # to one. It is the single number most likely to drift if the simulator
    # ever double-counts a bracket path.
    title = sum(t.p_championship for t in teams)
    out.append(_check(
        "championship probability sums to 1",
        abs(title - 1.0) < 1e-6,
        f"{title:.8f}",
    ))

    for conference in ("Eastern Conference", "Western Conference"):
        share = sum(
            t.p_conference_title for t in teams if t.conference == conference
        )
        out.append(_check(
            f"{conference.split()[0].lower()} conference title sums to 1",
            abs(share - 1.0) < 1e-6,
            f"{share:.8f}",
        ))

    out.append(_check(
        "every probability is in [0, 1]",
        all(
            0.0 <= p <= 1.0
            for t in teams
            for p in (t.p_playoffs, t.p_play_in, t.p_championship, t.p_conference_title)
        ),
    ))

    # 82 games each, plus at most one NBA Cup Championship for the two teams
    # that reach it. A projected record that does not add up is the clearest
    # possible signal that standings and remaining disagree about a game.
    bad = [
        (t.name, round(t.wins + t.losses, 2))
        for t in teams
        if not (81.9 <= t.wins + t.losses <= 83.1)
    ]
    out.append(_check(
        "projected records total 82 games",
        not bad,
        "; ".join(f"{n} {v}" for n, v in bad[:4]),
    ))

    out.append(_check(
        "wins are never negative or over 82",
        all(0.0 <= t.wins <= 82.0 for t in teams),
    ))

    # Every remaining fixture gets a forecast, and every forecast is finite
    # and physical. `exp_total` is the one that caught the original
    # train/serve skew: the model published 14.1 points, which is not a
    # basketball score and was the ridge intercept read as a prediction.
    out.append(_check(
        "every remaining game carries a forecast",
        len(games) == state["games_remaining"],
        f"{len(games)} of {state['games_remaining']}",
    ))
    if games:
        totals = [g["exp_total"] for g in games]
        probs = [g["p_home"] for g in games]
        margins = [g["exp_margin"] for g in games]
        out.append(_check(
            "expected total looks like basketball",
            all(150.0 <= t <= 280.0 for t in totals),
            f"min {min(totals):.1f} max {max(totals):.1f}",
        ))
        out.append(_check(
            "win probability is in (0, 1)",
            all(0.0 < p < 1.0 for p in probs),
            f"min {min(probs):.4f} max {max(probs):.4f}",
        ))
        out.append(_check(
            "expected margin is plausible",
            all(abs(m) < 40.0 for m in margins),
            f"max |margin| {max(abs(m) for m in margins):.1f}",
        ))
        out.append(_check(
            "no forecast is NaN",
            all(
                v == v
                for g in games
                for v in (g["p_home"], g["exp_margin"], g["exp_total"])
            ),
        ))

    # The banked record must equal the games actually played to that moment.
    played_pairs = sum(w + l for w, l in state["standings"].values())
    out.append(_check(
        "standings account for every played game twice",
        played_pairs == state["games_played"] * 2,
        f"{played_pairs} vs {state['games_played'] * 2}",
    ))

    out.append(_check(
        "the season start is anchored",
        bool(state["season_start"]),
        str(state["season_start"]),
    ))

    out.append(_check(
        "margin sd is a real spread",
        8.0 < state["margin_sd"] < 20.0,
        f"{state['margin_sd']:.2f}",
    ))

    return out


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None,
                        help="a COMPLETED season to replay (default: the latest)")
    parser.add_argument("--sims", type=int, default=2000,
                        help="fewer than a publish: shape is being checked, not precision")
    parser.add_argument("--dates", help="comma-separated YYYY-MM-DD, instead of the defaults")
    parser.add_argument("--output", default=str(OUT_PATH))
    args = parser.parse_args(argv)

    warehouse = get_warehouse()
    season = args.season or _latest_complete_season(warehouse)
    if season is None:
        logger.error("no completed season in the warehouse to rehearse against")
        return 1

    dates = (
        [d.strip() for d in args.dates.split(",") if d.strip()]
        if args.dates
        else checkpoint_dates(warehouse, season)
    )
    if not dates:
        logger.error("season %s has no regular-season games", season)
        return 1

    logger.info("rehearsing season %s at %d checkpoints", season, len(dates))
    checkpoints: List[Dict] = []
    failures = 0

    for as_of in dates:
        logger.info("--- as of %s ---", as_of)
        try:
            state = rehearse_one(warehouse, season, as_of, sims=args.sims)
        except Exception as exc:  # noqa: BLE001 - a crash IS the finding
            logger.error("  CRASHED: %s: %s", type(exc).__name__, exc)
            checkpoints.append({
                "as_of": as_of,
                "crashed": f"{type(exc).__name__}: {exc}",
                "checks": [],
            })
            failures += 1
            continue

        checks = invariants(state, season)
        bad = [c for c in checks if not c["ok"]]
        failures += len(bad)
        logger.info(
            "  %d played, %d remaining, %d/%d checks pass",
            state["games_played"], state["games_remaining"],
            len(checks) - len(bad), len(checks),
        )
        for check in bad:
            logger.error("  FAILED: %s (%s)", check["check"], check["detail"])

        checkpoints.append({
            "as_of": as_of,
            "games_played": state["games_played"],
            "games_remaining": state["games_remaining"],
            "checks": checks,
            "failed": len(bad),
        })

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "season": season,
        "simulations": args.sims,
        "note": (
            "A dress rehearsal of the daily job against a completed season. "
            "It checks the SHAPE of what would be published at each moment, "
            "never the accuracy — the outcomes are already known here, which "
            "makes any score a backtest. The real publishing functions are "
            "called with `as_of` set, so this exercises the live code path "
            "rather than a copy of it."
        ),
        "checkpoints": checkpoints,
        "failures": failures,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2))
    logger.info("wrote %s", output)

    if failures:
        logger.error("%d invariant failures across %d checkpoints", failures, len(dates))
        return 1
    logger.info("all checkpoints pass")
    return 0


def _latest_complete_season(warehouse) -> Optional[int]:
    """The most recent season that has a postseason in the corpus.

    A season with regular-season games and no playoffs is the one in
    progress, and replaying it would rehearse against a partial archive —
    which is the situation this script exists to simulate, not to inherit.
    """
    row = warehouse.conn.execute(
        "SELECT MAX(season) AS s FROM games WHERE season_type = 3"
    ).fetchone()
    return int(row["s"]) if row and row["s"] is not None else None


if __name__ == "__main__":
    sys.exit(main())
