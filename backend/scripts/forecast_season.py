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
* `playoff_bracket.json`    — the projected postseason: the modal occupant
  of each seed, the four first-round series priced by exact enumeration, and
  every franchise's marginal probability of reaching each round

It also writes the append-only half into the warehouse: one
`prediction_snapshots` row per fixture and one `odds_snapshots` row per
priced fixture, both stamped `generated_at`. **The JSON above is a view; those
rows are the record.** Every artifact here is overwritten by the next run, so
without them the only evidence of what was claimed in advance is that it
agrees with what is claimed now. `score_live` reads them back.

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
from backend.services.data.espn_loader import NBA_COMPETITION_ID
from backend.services.espn.client import current_season
from backend.services.forecast.version import model_version
from backend.services.playoffs.projection import (
    assign_projected_seeds,
    project_first_round,
)
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
    warehouse, franchises: Dict[int, Dict], as_of: Optional[str] = None
) -> Tuple[MarginModel, FeatureBuilder, np.ndarray]:
    """Fit the served model on every game played before `as_of`, in order.

    `as_of` defaults to None, meaning everything — which is what a real
    publish does. It exists so `rehearse` can stand the pipeline at a date in
    a completed season and run the ACTUAL publishing code against it, rather
    than a second implementation that agrees with it today. See that script
    for why a dress rehearsal is worth the parameter.
    """
    rows = [
        r
        for r in warehouse.iter_games(season_types=TRAIN_TYPES)
        if int(r["home_team_id"]) in franchises
        and int(r["away_team_id"]) in franchises
        and (as_of is None or str(r["date_utc"]) < as_of)
    ]
    if len(rows) < 5000:
        raise SystemExit(
            f"refusing to forecast from {len(rows)} games — run build_warehouse"
        )
    builder = FeatureBuilder(
        abbreviations={
            tid: info["abbreviation"]
            for tid, info in franchises.items()
            if info.get("abbreviation")
        }
    )
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
    warehouse, season: int, franchises: Dict[int, Dict],
    as_of: Optional[str] = None,
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
        if as_of is not None and str(row["date_utc"]) >= as_of:
            continue
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
    warehouse, season: int, franchises: Dict[int, Dict],
    as_of: Optional[str] = None,
) -> List[Dict]:
    """Games still to be played.

    Normally that means `scheduled_games`. **Under `as_of` it means the
    RESULTS table instead**, filtered to games that had not happened yet at
    that moment — because in a completed season every fixture has long since
    moved out of `scheduled_games` and into `games`. That substitution is the
    whole trick that lets a rehearsal replay a real season, and it is also
    the one place where a bug would silently hand the model the answers, so
    the result columns are dropped rather than carried through: what comes
    back here is a fixture, with no score attached, exactly as the live path
    sees one.
    """
    out = []
    source = (
        warehouse.iter_games(seasons=[season], season_types=(SEASON_TYPE_REGULAR,))
        if as_of is not None
        else warehouse.iter_scheduled(
            seasons=[season], season_types=(SEASON_TYPE_REGULAR,)
        )
    )
    for row in source:
        if as_of is not None and str(row["date_utc"]) < as_of:
            continue
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


def season_start(warehouse, season: int) -> Optional[str]:
    """The first regular-season tip-off of the season, played or scheduled.

    Published so the games page can number NBA weeks. **It must come from
    the whole season, not from the remaining fixtures** — anchoring week 1
    on the earliest game still to be played would reset the numbering to 1
    every morning once the season is under way, which is the sort of bug
    that looks right in October and is nonsense by December.
    """
    row = warehouse.conn.execute(
        """
        SELECT MIN(date_utc) AS start FROM (
            SELECT date_utc FROM games
             WHERE season = ? AND season_type = ?
            UNION ALL
            SELECT date_utc FROM scheduled_games
             WHERE season = ? AND season_type = ?
        )
        """,
        (season, SEASON_TYPE_REGULAR, season, SEASON_TYPE_REGULAR),
    ).fetchone()
    return row["start"] if row and row["start"] else None


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


def record_provenance(
    warehouse,
    games: Sequence[Dict],
    *,
    season: int,
    generated_at: str,
    version: str,
) -> Tuple[int, int]:
    """Write what was said, and the price it was said against, to the warehouse.

    **The published artifact is not a record.** `game_forecasts.json` is
    overwritten every morning by the next run, so on any given day the only
    evidence of yesterday's call is that it agrees with today's. These two
    tables are the append-only half: what the model claimed, at a stamped
    moment, under a named model version, against the price then available.

    Without them a live record cannot be built at all. It could only be
    *recomputed* from the corpus after the fact — which is a backtest, and
    this project draws a hard line between the two on every surface it has.
    `/accuracy` promises a live record that grows from zero; this function is
    what makes that promise keepable.

    The price goes in under the provider name `publish` rather than the
    book's own name. It is not a claim about what DraftKings showed at that
    instant — it is a claim about what this pipeline read, which is the only
    thing it can honestly attest to, and closing line value has to measure
    from a price somebody could actually have taken.
    """
    stamped = [
        {
            "fixture_uid": game["game_id"],
            "generated_at": generated_at,
            "model_version": version,
            "competition_id": NBA_COMPETITION_ID,
            "season": season,
            "tipoff_utc": game["date_utc"],
            "home_team": game["home"]["abbreviation"],
            "away_team": game["away"]["abbreviation"],
            "p_home": game.get("p_home"),
            "p_away": game.get("p_away"),
            "exp_margin": game.get("exp_margin"),
            "exp_total": game.get("exp_total"),
        }
        for game in games
    ]

    # Only games that carry a real two-sided price. A one-legged line is not
    # a market (see `market.has_complete_odds`) and storing it would put a
    # number in the CLV denominator that never existed as a tradeable price.
    priced = [
        {
            "game_id": game["game_id"],
            "provider": "publish",
            "captured_at": generated_at,
            "ml_home": (game.get("value") or {}).get("ml_home"),
            "ml_away": (game.get("value") or {}).get("ml_away"),
            "spread_home": (game.get("value") or {}).get("spread_home"),
            "total_points": (game.get("value") or {}).get("total_points"),
            "before_tipoff": True,
        }
        for game in games
        if game.get("value")
    ]

    return (
        warehouse.record_predictions(stamped),
        warehouse.record_odds(priced),
    )


def append_forecast_log(
    path: Path, games: Sequence[Dict], *, season: int, generated_at: str, version: str
) -> int:
    """The durable copy of the live record. First write per fixture wins.

    **The warehouse is not a safe home for this on its own.** It is gitignored
    derived data, restored each morning from a release asset, and the daily
    job falls back to `build_warehouse --seasons 2004-2027` if that download
    ever fails. Every other table survives that: results, prices and ratings
    can all be fetched from ESPN again. **A record of what was forecast before
    a game cannot be.** One transient network failure would otherwise destroy
    the live record permanently and nothing would report it — the rebuild
    would succeed, the site would look right, and the only evidence anything
    had been claimed in advance would be gone.

    So the first forecast per fixture is also written here, into a file that
    is committed to git. It is small by construction: one row per fixture for
    the whole season, roughly 1,200 lines, not one per fixture per run.

    **First write wins and is never revised.** A later run producing a better
    number for the same game does not get to replace the one that was
    actually published, which is the entire point of the file. The warehouse
    keeps every later snapshot; this keeps the one that counts.
    """
    payload = _read_log(path)
    forecasts: Dict[str, Dict] = payload.setdefault("forecasts", {})

    added = 0
    for game in games:
        game_id = str(game["game_id"])
        if game_id in forecasts:
            continue
        # A forecast stamped after tip-off is not a forecast. It cannot be
        # scored as one later, so it is not written as one now.
        if str(generated_at) >= str(game["date_utc"]):
            continue
        value = game.get("value") or {}
        forecasts[game_id] = {
            "generated_at": generated_at,
            "model_version": version,
            "season": season,
            "tipoff_utc": game["date_utc"],
            "home_team": game["home"]["abbreviation"],
            "away_team": game["away"]["abbreviation"],
            "p_home": game.get("p_home"),
            "exp_margin": game.get("exp_margin"),
            "exp_total": game.get("exp_total"),
            "ml_home": value.get("ml_home"),
            "ml_away": value.get("ml_away"),
        }
        added += 1

    # Nothing new means nothing to write. Once a season's fixtures are all
    # logged this runs every morning and touches no bytes, so the daily job
    # is not committing a re-serialised copy of an append-only file for the
    # sake of a changed timestamp.
    if not added:
        return 0

    payload["note"] = (
        "The first forecast published for each fixture, before its tip-off. "
        "Append-only: an entry is never revised, because the point of the "
        "file is what was actually claimed rather than the best number "
        "available afterwards. This is the durable copy of the live record; "
        "the warehouse holds every later snapshot and is not committed."
    )
    payload["updated_at"] = generated_at
    payload["n"] = len(forecasts)
    _publish(path, payload)
    return added


def _read_log(path: Path) -> Dict:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


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
            "season_start": season_start(warehouse, season),
            "generated_at": generated_at,
            "model_version": version,
            "n_games": len(games),
            "n_priced": priced,
            "n_flagged": flagged,
            "min_edge": MIN_EDGE,
            "games": games,
        },
    )

    # The append-only half. Everything above is overwritten next run; this is
    # what survives to be scored as a LIVE record rather than reconstructed
    # as a backtest. See `record_provenance`.
    n_pred, n_odds = record_provenance(
        warehouse,
        games,
        season=season,
        generated_at=generated_at,
        version=version,
    )
    new_to_log = append_forecast_log(
        out_dir / "forecast_log.json",
        games,
        season=season,
        generated_at=generated_at,
        version=version,
    )
    logger.info(
        "provenance: %d forecasts and %d prices stamped at %s; %d fixtures "
        "newly entered in the committed forecast log",
        n_pred,
        n_odds,
        generated_at,
        new_to_log,
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

    _publish(
        out_dir / "playoff_bracket.json",
        _projected_bracket(
            result,
            franchises=franchises,
            elo=elo_snapshot,
            simulator=simulator,
            generated_at=generated_at,
            version=version,
        ),
    )

    _print_summary(result, ratings, priced, flagged, len(games))
    return 0


def _projected_bracket(
    result,
    *,
    franchises: Dict[int, Dict],
    elo: Dict[int, float],
    simulator: SeasonSimulator,
    generated_at: str,
    version: str,
) -> Dict:
    """The projected postseason, per conference.

    **Priced with the simulator's own game probability**, passed in rather
    than reimplemented. A bracket that computes its series odds from a second
    copy of the same maths will eventually disagree with the season
    projection printed beside it, and the disagreement will be small enough
    that nobody notices it is a bug.
    """
    enriched: Dict[str, List[Dict]] = defaultdict(list)
    for team in result.teams:
        info = franchises.get(team.team_id, {})
        enriched[team.conference].append(
            {
                "team_id": team.team_id,
                "name": team.name,
                "abbreviation": info.get("abbreviation"),
                "logo": info.get("logo"),
                "conference": team.conference,
                "wins": round(team.wins, 1),
                "losses": round(team.losses, 1),
                "seed_distribution": {
                    str(k): v for k, v in team.seed_distribution.items()
                },
            }
        )

    conferences: Dict[str, Dict] = {}
    for conference, members in enriched.items():
        seeds = assign_projected_seeds(members)
        conferences[conference] = {
            "seeds": [
                {
                    "seed": entry["seed"],
                    "p_seed": round(entry["p_seed"], 4),
                    "team_id": entry["team"]["team_id"],
                    "name": entry["team"]["name"],
                    "abbreviation": entry["team"]["abbreviation"],
                    "logo": entry["team"]["logo"],
                    "wins": entry["team"]["wins"],
                    "losses": entry["team"]["losses"],
                }
                for entry in seeds
            ],
            "first_round": project_first_round(
                seeds,
                game_probability=simulator.game_probability,
                elo=elo,
            ),
        }

    rounds = [
        {
            "team_id": t.team_id,
            "name": t.name,
            "abbreviation": franchises.get(t.team_id, {}).get("abbreviation"),
            "logo": franchises.get(t.team_id, {}).get("logo"),
            "conference": t.conference,
            "p_playoffs": round(t.p_playoffs, 4),
            "p_conf_semis": round(t.p_conf_semis, 4),
            "p_conf_finals": round(t.p_conf_finals, 4),
            "p_finals": round(t.p_conference_title, 4),
            "p_title": round(t.p_championship, 4),
        }
        for t in sorted(result.teams, key=lambda t: -t.p_championship)
    ]

    return {
        "season": result.season,
        "generated_at": generated_at,
        "model_version": version,
        "simulations": result.simulations,
        "games_played": result.games_played,
        "basis": "projection",
        "conferences": conferences,
        "rounds": rounds,
        "note": (
            "The drawn bracket is the MODAL first round: the most likely "
            "occupant of each seed, with the probability it actually lands "
            "there printed beside it. Series odds are exact enumerations over "
            "a best-of-seven, not simulated estimates. Everything past round "
            "one is reported as a marginal probability from the simulation, "
            "which integrates over every seeding — reading a fixed bracket "
            "four rounds forward would compound one seeding assumption into a "
            "championship number."
        ),
    }


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
