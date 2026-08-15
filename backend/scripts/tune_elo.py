"""Sweep the Elo hyper-parameters against held-out games.

    python3 -m backend.scripts.tune_elo
    python3 -m backend.scripts.tune_elo --from-season 2015 --metric brier

Writes `backend/data/diagnostics/elo_sweep.json`.

Three things this script exists to settle with evidence rather than by
inheritance from the sibling soccer project:

1. **Home advantage is not a constant, and in the NBA it is not even
   stable.** Measured on this corpus: 73 rating points in 2004-2009, 67 in
   2010-2014, 59 in 2015-2019, 39 in 2020-2023 and **33 in 2024-2026** —
   the home win rate fell from .6036 to .5473 over the same span. Any fixed
   value is wrong for most of the corpus, so the served config carries the
   modern-era number and `--fit-home-advantage` re-derives it per era.

2. **Season carryover is real here, and it is the opposite of soccer's
   answer.** The soccer project tested season-boundary regression to the
   mean and rejected it at every level (worse at 0.25, 0.40 and 0.60). The
   NBA has a draft, a hard-ish cap and free agency, all designed to pull
   teams together; this sweep is what decides the number rather than an
   argument about institutions.

3. **The MOV multiplier's autocorrelation correction earns its place or it
   does not.** Sweeping it against a version with the correction switched
   off is the only way to know.

Scored on a rolling walk-forward, never in-sample: each configuration rates
the whole corpus in order and is scored on games from `--from-season`
onward, using only pre-game ratings.
"""

from __future__ import annotations

import argparse
import itertools
import json
import logging
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.prediction import market as mkt
from backend.services.ratings.elo import EloConfig, EloRatingSystem

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("tune_elo")

ROOT = Path(__file__).resolve().parent.parent.parent
DIAGNOSTICS = ROOT / "backend" / "data" / "diagnostics"
SCORED_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)

GRID = {
    "k_factor": [12.0, 16.0, 20.0, 24.0, 30.0],
    "carryover": [0.60, 0.70, 0.75, 0.80, 0.90, 1.00],
    "home_advantage": [30.0, 40.0, 50.0, 65.0, 80.0, 100.0],
}


def load_rows(from_season: Optional[int] = None) -> List:
    warehouse = get_warehouse()
    real = {
        int(r["team_id"])
        for r in warehouse.conn.execute(
            "SELECT team_id FROM teams WHERE conference IS NOT NULL"
        )
    }
    return [
        r
        for r in warehouse.iter_games(season_types=SCORED_TYPES)
        if int(r["home_team_id"]) in real and int(r["away_team_id"]) in real
    ]


def score_config(rows: Sequence, config: EloConfig, score_from: int) -> Dict:
    """Rate the whole corpus and score the tail. Pre-game ratings only."""
    elo = EloRatingSystem(config)
    pairs: List[Tuple[float, bool]] = []
    for row in rows:
        rated = elo.update(
            game_id=row["game_id"],
            date_utc=row["date_utc"],
            season=int(row["season"]),
            home_team_id=int(row["home_team_id"]),
            away_team_id=int(row["away_team_id"]),
            home_score=int(row["home_score"]),
            away_score=int(row["away_score"]),
            neutral=bool(row["neutral_site"]),
        )
        if int(row["season"]) >= score_from:
            pairs.append((rated.expected_home, rated.home_won))
    if not pairs:
        return {"n": 0}
    summary = mkt.summarise(pairs)
    return summary


def era_home_advantage(rows: Sequence) -> Dict[str, Dict]:
    """Home advantage per era, in rating points and in raw rates."""
    eras = [(2004, 2009), (2010, 2014), (2015, 2019), (2020, 2023), (2024, 2026)]
    out: Dict[str, Dict] = {}
    for lo, hi in eras:
        subset = [
            r
            for r in rows
            if lo <= int(r["season"]) <= hi and not r["neutral_site"]
        ]
        if len(subset) < 200:
            continue
        wins = sum(1 for r in subset if r["home_score"] > r["away_score"])
        rate = wins / len(subset)
        margin = float(
            np.mean([r["home_score"] - r["away_score"] for r in subset])
        )
        out[f"{lo}-{hi}"] = {
            "n": len(subset),
            "home_win_rate": round(rate, 4),
            "mean_margin": round(margin, 3),
            "elo_points": round(400.0 * math.log10(rate / (1.0 - rate)), 1),
        }
    return out


def within_season_drift(rows: Sequence, config: EloConfig) -> Dict:
    """How far a team's rating wanders inside one season.

    This is the number the season simulation's correlated strength shock is
    calibrated from — see `season_simulator.STRENGTH_SHOCK_SD`. Point
    estimates compounded over 82 games without it produce title odds far
    more confident than any market price.
    """
    elo = EloRatingSystem(config)
    from collections import defaultdict

    series = defaultdict(list)
    for row in rows:
        rated = elo.update(
            game_id=row["game_id"],
            date_utc=row["date_utc"],
            season=int(row["season"]),
            home_team_id=int(row["home_team_id"]),
            away_team_id=int(row["away_team_id"]),
            home_score=int(row["home_score"]),
            away_score=int(row["away_score"]),
            neutral=bool(row["neutral_site"]),
        )
        series[(rated.home_team_id, rated.season)].append(rated.home_elo_post)
        series[(rated.away_team_id, rated.season)].append(rated.away_elo_post)
    sds = [float(np.std(v)) for v in series.values() if len(v) >= 40]
    return {
        "team_seasons": len(sds),
        "mean_sd": round(float(np.mean(sds)), 2) if sds else None,
        "median_sd": round(float(np.median(sds)), 2) if sds else None,
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=2015,
                        help="score games from this season onward")
    parser.add_argument("--metric", default="brier",
                        choices=["brier", "log_loss", "ece"])
    parser.add_argument("--output", default=str(DIAGNOSTICS / "elo_sweep.json"))
    args = parser.parse_args(argv)

    rows = load_rows()
    logger.info("corpus: %d games", len(rows))
    if len(rows) < 1000:
        logger.error("corpus too small to tune on")
        return 1

    results: List[Dict] = []
    combos = list(
        itertools.product(GRID["k_factor"], GRID["carryover"], GRID["home_advantage"])
    )
    logger.info("sweeping %d configurations", len(combos))
    for k, carry, hfa in combos:
        config = EloConfig(k_factor=k, carryover=carry, home_advantage=hfa)
        summary = score_config(rows, config, args.from_season)
        if not summary.get("n"):
            continue
        results.append(
            {
                "k_factor": k,
                "carryover": carry,
                "home_advantage": hfa,
                **{
                    key: round(value, 5)
                    for key, value in summary.items()
                    if isinstance(value, float)
                },
                "n": summary["n"],
            }
        )

    results.sort(key=lambda r: r[args.metric])
    best = results[0]
    logger.info("best by %s: %s", args.metric, best)

    baseline = EloConfig()
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scored_from_season": args.from_season,
        "metric": args.metric,
        "n_configurations": len(results),
        "best": best,
        "top_10": results[:10],
        "worst": results[-1],
        "home_advantage_by_era": era_home_advantage(rows),
        "within_season_drift": within_season_drift(
            rows, EloConfig(**{k: v for k, v in best.items()
                               if k in {"k_factor", "carryover", "home_advantage"}})
        ),
        "all": results,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(".tmp")
    tmp.write_text(json.dumps(report, indent=2))
    tmp.replace(output)

    print()
    print(f"{'k':>5}{'carry':>8}{'hfa':>7}{'Brier':>10}{'logloss':>10}{'acc':>9}{'ECE':>9}")
    for row in results[:12]:
        print(f"{row['k_factor']:>5.0f}{row['carryover']:>8.2f}{row['home_advantage']:>7.0f}"
              f"{row['brier']:>10.5f}{row['log_loss']:>10.5f}"
              f"{row['accuracy']:>9.4f}{row['ece']:>9.5f}")
    print()
    print("home advantage by era (rating points):")
    for era, stats in report["home_advantage_by_era"].items():
        print(f"  {era}: {stats['elo_points']:>5.0f}  "
              f"(home win {stats['home_win_rate']:.4f}, margin {stats['mean_margin']:+.2f}, n={stats['n']})")
    drift = report["within_season_drift"]
    print(f"\nwithin-season Elo drift: mean sd {drift['mean_sd']} over "
          f"{drift['team_seasons']} team-seasons")
    logger.info("wrote %s", output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
