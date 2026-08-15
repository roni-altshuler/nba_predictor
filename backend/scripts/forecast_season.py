"""Publish the season forecast, the game forecasts, and the value surface.

    python3 -m backend.scripts.forecast_season
    python3 -m backend.scripts.forecast_season --sims 20000 --season 2027

Writes into `backend/data/predictions/`:

* `season_projections.json` — every franchise's projected record, seed
  distribution, playoff/conference/championship odds
* `game_forecasts.json`     — every remaining scheduled game: win
  probability, expected margin and total, and the value surface where a
  price exists
* `power_ratings.json`      — current Elo, for the ratings page

**It re-syncs every run, by construction.** Nothing here is a preseason
snapshot: each run rebuilds ratings from every game played to date, so the
projection tightens as the season runs and games already played leave the
remaining set. That is the same property the sibling soccer project relies
on, and the same guard applies — a fixture already in the results corpus is
dropped whatever the schedule claims.

**Artifacts are published via temp-file + os.replace**, so a crash mid-write
leaves the previous valid forecast serving rather than a truncated file.

**It refuses to publish a projection missing franchises the live artifact
serves.** Comparing against what is on disk rather than against a constant,
so a genuine expansion team is a decision someone makes, not something a bad
ingest does silently.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import defaultdict
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
from backend.services.espn.client import current_season
from backend.services.forecast.version import model_version
from backend.services.prediction import market as mkt
from backend.services.prediction.feature_builder import (
    FEATURE_NAMES,
    FeatureBuilder,
    dead_feature_blocks,
)
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import EloConfig
from backend.services.simulation.season_simulator import (
    STRENGTH_SHOCK_SD,
    SeasonSimulator,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("forecast_season")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "backend" / "data" / "predictions"
DIAGNOSTICS = ROOT / "backend" / "data" / "diagnostics"

TRAIN_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)

# A value flag needs a probability we can defend. `/accuracy` gates the
# product on measured calibration, and the measured ECE is .0095 — so an
# edge smaller than that is inside our own error bar and is not published
# as an edge.
MIN_EDGE = 0.02


def load_franchises(warehouse) -> Dict[int, Dict]:
    return {
        int(r["team_id"]): {
            "name": r["display_name"],
            "abbreviation": r["abbreviation"],
            "conference": r["conference"],
            "logo": r["logo"],
            "espn_id": r["espn_id"],
        }
        for r in warehouse.conn.execute(
            "SELECT * FROM teams WHERE conference IS NOT NULL"
        )
    }


def train_through(
    warehouse, franchises: Dict[int, Dict]
) -> Tuple[MarginModel, FeatureBuilder, np.ndarray]:
    """Fit the served model on every game ever played, in order."""
    rows = [
        r
        for r in warehouse.iter_games(season_types=TRAIN_TYPES)
        if int(r["home_team_id"]) in franchises
        and int(r["away_team_id"]) in franchises
    ]
    if len(rows) < 5000:
        raise SystemExit(
            f"refusing to forecast from {len(rows)} games — run build_warehouse"
        )
    builder = FeatureBuilder()
    X, margins, totals, meta = builder.build(rows)
    model = MarginModel()
    model.fit(
        X,
        margins,
        totals,
        FEATURE_NAMES,
        trained_through=meta[-1]["date_utc"] if meta else None,
    )
    logger.info(
        "trained on %d games through %s (margin sd %.2f, total sd %.2f)",
        len(X),
        model.params.trained_through,
        model.params.margin_sd,
        model.params.total_sd,
    )
    return model, builder, X


def current_standings(
    warehouse, season: int, franchises: Dict[int, Dict]
) -> Dict[int, Tuple[int, int]]:
    """Wins and losses already banked this season.

    The NBA Cup Championship is excluded: ESPN files it as a regular-season
    game but it does not count in the standings, so including it would put
    one franchise on 83 games and shift its projected record.
    """
    standings: Dict[int, List[int]] = defaultdict(lambda: [0, 0])
    for row in warehouse.iter_games(
        seasons=[season], season_types=(SEASON_TYPE_REGULAR,)
    ):
        phase = (row["phase"] or "").lower()
        if "cup championship" in phase:
            continue
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home not in franchises or away not in franchises:
            continue
        if row["home_score"] > row["away_score"]:
            standings[home][0] += 1
            standings[away][1] += 1
        else:
            standings[away][0] += 1
            standings[home][1] += 1
    return {k: (v[0], v[1]) for k, v in standings.items()}


def remaining_schedule(
    warehouse, season: int, franchises: Dict[int, Dict]
) -> List[Dict]:
    """Scheduled regular-season games still to be played."""
    out = []
    for row in warehouse.iter_scheduled(
        seasons=[season], season_types=(SEASON_TYPE_REGULAR,)
    ):
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home not in franchises or away not in franchises:
            continue
        out.append(
            {
                "game_id": row["game_id"],
                "date_utc": row["date_utc"],
                "home_team_id": home,
                "away_team_id": away,
                "venue": row["venue"],
                "neutral_site": int(row["neutral_site"] or 0),
                "ml_home": row["ml_home"],
                "ml_away": row["ml_away"],
                "spread_home": row["spread_home"],
                "total_points": row["total_points"],
            }
        )
    return out


def _parse_utc(iso: str) -> datetime:
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))


def forecast_games(
    model: MarginModel,
    builder: FeatureBuilder,
    games: Sequence[Dict],
    franchises: Dict[int, Dict],
    train_X: Optional[np.ndarray] = None,
) -> List[Dict]:
    """A forecast per remaining game, plus the value surface where priced."""
    out: List[Dict] = []
    if not games:
        return out

    # Build the full served vector for every game, then predict in one pass.
    # `predict_from_elo` is NOT used here: it knows only the rating gap, and
    # feeding a 19-feature model a rating gap makes it fall back to its
    # intercept for everything else — which published an expected total of
    # 14.1 points on the first run. See `FeatureBuilder.vector_for`.
    vectors = np.vstack(
        [
            builder.vector_for(
                game["home_team_id"],
                game["away_team_id"],
                _parse_utc(game["date_utc"]),
                neutral=bool(game["neutral_site"]),
            )
            for game in games
        ]
    )
    forecasts = model.predict(vectors)

    dead = dead_feature_blocks(train_X, vectors) if train_X is not None else []
    if dead:
        logger.error(
            "TRAIN/SERVE SKEW: %s vary in training and are constant at serve "
            "time. Every forecast below is running on a synthesised value for "
            "them. Fix the serving path before trusting this artifact.",
            dead,
        )

    for game, forecast in zip(games, forecasts):
        home, away = game["home_team_id"], game["away_team_id"]
        home_elo = builder.elo.get(home)
        away_elo = builder.elo.get(away)
        record = {
            "game_id": game["game_id"],
            "date_utc": game["date_utc"],
            "venue": game["venue"],
            "neutral_site": bool(game["neutral_site"]),
            "home": _side(franchises[home], home, home_elo),
            "away": _side(franchises[away], away, away_elo),
            **forecast.as_dict(),
        }
        value = _value_surface(forecast, game)
        if value:
            record["value"] = value
        out.append(record)
    return out


def _side(team: Dict, team_id: int, elo: float) -> Dict:
    return {
        "team_id": team_id,
        "name": team["name"],
        "abbreviation": team["abbreviation"],
        "conference": team["conference"],
        "logo": team["logo"],
        "elo": round(elo, 1),
    }


def _value_surface(forecast, game: Dict) -> Optional[Dict]:
    """Model probability against the no-vig price, with EV and a stake.

    Returns None when there is no price. **A missing market is reported as
    missing**, never as a zero edge — the whole point of this surface is the
    comparison, and a game with no line has nothing to compare against.
    """
    if not mkt.has_complete_odds(game.get("ml_home"), game.get("ml_away")):
        return None
    try:
        fair_home, fair_away = mkt.devig(
            float(game["ml_home"]), float(game["ml_away"])
        )
        decimal_home = mkt.american_to_decimal(float(game["ml_home"]))
        decimal_away = mkt.american_to_decimal(float(game["ml_away"]))
    except mkt.MarketError as exc:
        logger.debug("unusable price on %s: %s", game["game_id"], exc)
        return None

    edge_home = forecast.p_home - fair_home
    edge_away = forecast.p_away - fair_away
    side = "home" if edge_home >= edge_away else "away"
    edge = max(edge_home, edge_away)
    model_prob = forecast.p_home if side == "home" else forecast.p_away
    decimal = decimal_home if side == "home" else decimal_away

    return {
        "ml_home": game["ml_home"],
        "ml_away": game["ml_away"],
        "fair_home": round(fair_home, 4),
        "fair_away": round(fair_away, 4),
        "overround": round(
            mkt.overround(float(game["ml_home"]), float(game["ml_away"])), 4
        ),
        "spread_home": game.get("spread_home"),
        "total_points": game.get("total_points"),
        "edge_home": round(edge_home, 4),
        "edge_away": round(edge_away, 4),
        "best_side": side,
        "edge": round(edge, 4),
        "expected_value": round(mkt.expected_value(model_prob, decimal), 4),
        "kelly": round(mkt.kelly_fraction(model_prob, decimal), 4),
        # The flag is gated on the edge clearing our own measured
        # calibration error. Below that, "value" is indistinguishable from
        # the model being slightly miscalibrated.
        "flagged": bool(edge >= MIN_EDGE),
        "min_edge": MIN_EDGE,
    }


def _publish(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(path)
    logger.info("wrote %s", path)


def _teams_lost(path: Path, publishing: set) -> List[str]:
    """Franchises the live artifact serves that this run would drop."""
    if not path.exists():
        return []
    try:
        previous = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    served = {t["name"] for t in previous.get("teams", [])}
    return sorted(served - publishing)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--sims", type=int, default=20000)
    parser.add_argument("--allow-missing-teams", action="store_true")
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    args = parser.parse_args(argv)

    season = args.season or current_season()
    warehouse = get_warehouse()
    franchises = load_franchises(warehouse)
    if len(franchises) != 30:
        logger.warning("%d franchises carry a conference, expected 30", len(franchises))

    model, builder, train_X = train_through(warehouse, franchises)
    standings = current_standings(warehouse, season, franchises)
    remaining = remaining_schedule(warehouse, season, franchises)
    logger.info(
        "season %s: %d games banked, %d remaining",
        season,
        sum(w + l for w, l in standings.values()) // 2,
        len(remaining),
    )

    # Apply the offseason regression when projecting a season that has not
    # started. See `EloRatingSystem.regress_to_season` — without this the
    # projection runs on end-of-last-season ratings and silently drops the
    # single most valuable setting the Elo sweep measured.
    if builder.elo.regress_to_season(season):
        logger.info(
            "applied offseason regression (carryover %.2f) — %s has not "
            "started, so ratings come forward regressed rather than raw",
            builder.elo.config.carryover,
            season,
        )

    elo_snapshot = {tid: builder.elo.get(tid) for tid in franchises}
    teams_for_sim = {
        tid: {
            "name": info["name"],
            "conference": info["conference"],
            "elo": elo_snapshot[tid],
        }
        for tid, info in franchises.items()
    }

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    config = {
        "features": list(FEATURE_NAMES),
        "elo": EloConfig().as_dict(),
        "shock_sd": STRENGTH_SHOCK_SD,
        "sims": args.sims,
        "season": season,
        "margin_sd": model.params.margin_sd,
        "total_sd": model.params.total_sd,
    }
    version = model_version(config)
    logger.info("model version %s", version)

    simulator = SeasonSimulator(
        simulations=args.sims,
        home_advantage_elo=builder.elo.config.home_advantage,
        margin_sd=model.params.margin_sd,
    )
    result = simulator.simulate(
        season=season,
        teams=teams_for_sim,
        standings=standings,
        remaining=[(g["home_team_id"], g["away_team_id"]) for g in remaining],
        generated_at=generated_at,
    )

    out_dir = Path(args.out_dir)
    publishing = {t.name for t in result.teams}
    lost = _teams_lost(out_dir / "season_projections.json", publishing)
    if lost and not args.allow_missing_teams:
        logger.error(
            "refusing to publish: the live artifact serves %d franchises this "
            "run would drop (%s). Leaving the previous forecast up. Use "
            "--allow-missing-teams only for a franchise that genuinely no "
            "longer exists.",
            len(lost),
            ", ".join(lost[:5]),
        )
        return 1

    projections = result.as_dict()
    projections["model_version"] = version
    projections["config"] = config
    projections["measured"] = _measured_block()
    _publish(out_dir / "season_projections.json", projections)

    games = forecast_games(model, builder, remaining, franchises, train_X)
    priced = sum(1 for g in games if g.get("value"))
    flagged = sum(1 for g in games if (g.get("value") or {}).get("flagged"))
    _publish(
        out_dir / "game_forecasts.json",
        {
            "season": season,
            "generated_at": generated_at,
            "model_version": version,
            "n_games": len(games),
            "n_priced": priced,
            "n_flagged": flagged,
            "min_edge": MIN_EDGE,
            "games": games,
        },
    )

    ratings = sorted(
        (
            {
                "team_id": tid,
                "name": info["name"],
                "abbreviation": info["abbreviation"],
                "conference": info["conference"],
                "logo": info["logo"],
                "elo": round(elo_snapshot[tid], 1),
            }
            for tid, info in franchises.items()
        ),
        key=lambda r: -r["elo"],
    )
    for rank, row in enumerate(ratings, start=1):
        row["rank"] = rank
    _publish(
        out_dir / "power_ratings.json",
        {
            "season": season,
            "generated_at": generated_at,
            "model_version": version,
            "teams": ratings,
        },
    )

    _print_summary(result, ratings, priced, flagged, len(games))
    return 0


def _measured_block() -> Dict:
    """The evidence block, read from the benchmark artifact.

    Read rather than hard-coded: a number typed into the publisher is a
    number that stops being true the next time the benchmark runs, and
    nothing would say so.
    """
    path = DIAGNOSTICS / "market_benchmark.json"
    if not path.exists():
        return {"available": False, "reason": "benchmark_market has not been run"}
    try:
        report = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"available": False, "reason": "benchmark artifact unreadable"}
    paired = report.get("paired_vs_market") or {}
    full = report.get("full_corpus") or {}
    return {
        "available": True,
        "generated_at": report.get("generated_at"),
        "walk_forward_n": full.get("n"),
        "walk_forward_brier": (full.get("model") or {}).get("brier"),
        "walk_forward_ece": (full.get("model") or {}).get("ece"),
        "paired_n": paired.get("n"),
        "market_brier": (paired.get("market") or {}).get("brier"),
        "model_brier": (paired.get("model") or {}).get("brier"),
        "gap_to_market": paired.get("model_gap_to_market"),
        "bootstrap": paired.get("bootstrap"),
        "basis": "historical walk-forward; not a live published record",
    }


def _print_summary(result, ratings, priced, flagged, n_games) -> None:
    print()
    print(f"SEASON {result.season} — {result.simulations} simulations, "
          f"{result.games_played} played, {result.games_remaining} remaining")
    print()
    for conference in ("Eastern Conference", "Western Conference"):
        members = [t for t in result.teams if t.conference == conference]
        members.sort(key=lambda t: -t.wins)
        print(f"  {conference}")
        print(f"  {'team':<26}{'W':>6}{'L':>6}{'playoffs':>10}{'conf':>8}{'title':>8}")
        for team in members:
            print(f"  {team.name:<26}{team.wins:>6.1f}{team.losses:>6.1f}"
                  f"{team.p_playoffs:>10.1%}{team.p_conference_title:>8.1%}"
                  f"{team.p_championship:>8.1%}")
        print()
    print("  top 5 power ratings: " + ", ".join(
        f"{r['abbreviation']} {r['elo']:.0f}" for r in ratings[:5]))
    print(f"  game forecasts: {n_games} ({priced} priced, {flagged} flagged)")
    print()


if __name__ == "__main__":
    sys.exit(main())
