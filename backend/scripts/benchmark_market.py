"""Walk-forward benchmark: the model, the market, and the floors.

    python3 -m backend.scripts.benchmark_market
    python3 -m backend.scripts.benchmark_market --from-season 2016 --refit-months 1

This is the script that produces the numbers quoted in CLAUDE.md, and the
rule inherited from the sibling soccer project is absolute: **any accuracy
claim is stated as a paired score against the market on named games, or it
is not stated.**

The design is shaped by two bugs the soccer project paid for, and the
guards against both are load-bearing here:

1. **Never slice one ordering against another.** The soccer benchmark
   re-sorted its split by `(date, competition)` while the corpus iterator
   yielded `(date, match_id)`, then indexed positionally into the result.
   Every game sharing a date with another was scored against a different
   game's closing price and a different game's teams. The market read .6911
   instead of .5757 and 70% of the corpus was silently dropped. Here the
   feature builder emits metadata **alongside** each row, in the same list,
   so a row and its result cannot come apart — there is no index to get
   wrong.

2. **Refit on a rolling clock, not once at the split.** The soccer
   Dixon-Coles was fitted once and then used across a three-year test
   window. This refits every `--refit-months`.

And the rule that follows from both: **whenever a challenger beats the
closing line, suspect the harness first.** A model with no market features
cannot out-predict the market. That result is a bug announcing itself.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
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
from backend.services.prediction.feature_builder import (
    FEATURE_NAMES,
    FeatureBuilder,
    zero_variance,
)
from backend.services.prediction.margin_model import MarginModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("benchmark_market")

ROOT = Path(__file__).resolve().parent.parent.parent
DIAGNOSTICS = ROOT / "backend" / "data" / "diagnostics"

# The benchmark corpus. Regular season and playoffs both count — unlike
# soccer's league/cup split, an NBA playoff game is the same game under more
# pressure, and excluding it would drop the fixtures anyone most wants a
# forecast for. The play-in is included for the same reason. Preseason and
# the All-Star exhibition are not games: rotations are not competitive.
SCORED_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)


def load_corpus(from_season: int, to_season: Optional[int] = None):
    warehouse = get_warehouse()
    seasons = None
    if to_season:
        seasons = list(range(from_season, to_season + 1))
    rows = list(
        warehouse.iter_games(seasons=seasons, season_types=SCORED_TYPES)
    )
    if not to_season:
        rows = [r for r in rows if int(r["season"]) >= from_season]
    # Exhibition sides (All-Star, international preseason opponents) carry no
    # conference. They are filtered by participation, not by name — the same
    # rule the soccer project uses to keep the MLS All-Star Game out of a
    # 30-team league table.
    real = _conference_team_ids(warehouse)
    kept = [
        r
        for r in rows
        if int(r["home_team_id"]) in real and int(r["away_team_id"]) in real
    ]
    dropped = len(rows) - len(kept)
    if dropped:
        logger.info("dropped %d games involving a non-franchise side", dropped)
    return kept


def _conference_team_ids(warehouse) -> set:
    return {
        int(r["team_id"])
        for r in warehouse.conn.execute(
            "SELECT team_id FROM teams WHERE conference IS NOT NULL"
        )
    }


def walk_forward(
    rows: Sequence,
    *,
    train_seasons: int,
    refit_months: int,
    ridge: float,
) -> Tuple[List[Dict], Dict]:
    """Rolling-origin evaluation over the corpus.

    Returns per-game records and a summary of what was and was not scored.
    """
    builder = FeatureBuilder()
    X, margins, totals, meta = builder.build(rows)
    logger.info("built %d feature rows x %d features", len(X), X.shape[1])

    constant = zero_variance(X)
    if constant:
        logger.warning(
            "ZERO-VARIANCE features on this corpus (each one spends a "
            "coefficient for nothing): %s",
            constant,
        )

    dates = np.array([m["date_utc"] for m in meta])
    seasons = np.array([m["season"] for m in meta])
    first_season = int(seasons.min())
    start_season = first_season + train_seasons

    scored: List[Dict] = []
    model = MarginModel()
    fitted_through: Optional[str] = None
    next_refit: Optional[datetime] = None
    refits = 0

    for i in range(len(X)):
        season = int(seasons[i])
        if season < start_season:
            continue
        when = datetime.fromisoformat(dates[i].replace("Z", "+00:00"))

        if next_refit is None or when >= next_refit:
            # Train on everything strictly before this game. `<` not `<=`:
            # a game must never be in its own training set, and the corpus
            # holds same-timestamp games.
            train_mask = dates < dates[i]
            n_train = int(train_mask.sum())
            if n_train < 500:
                continue
            model = MarginModel()
            model.fit(
                X[train_mask],
                margins[train_mask],
                totals[train_mask],
                FEATURE_NAMES,
                ridge=ridge,
                trained_through=dates[i],
            )
            fitted_through = dates[i]
            next_refit = when + timedelta(days=30 * refit_months)
            refits += 1

        if fitted_through is None:
            continue

        forecast = model.predict(X[i : i + 1])[0]
        record = dict(meta[i])
        record["p_home_model"] = forecast.p_home
        record["exp_margin"] = forecast.exp_margin
        record["exp_total"] = forecast.exp_total
        record["margin_sd"] = forecast.margin_sd

        # Elo-only baseline, from the same pre-game ratings the features saw.
        elo_forecast = model.predict_from_elo(
            record["elo_home"],
            record["elo_away"],
            neutral=False,
            home_advantage_elo=builder.elo.config.home_advantage,
        )
        record["p_home_elo"] = elo_forecast.p_home

        scored.append(record)

    logger.info("scored %d games across %d refits", len(scored), refits)
    return scored, {
        "n_feature_rows": int(len(X)),
        "n_scored": len(scored),
        "refits": refits,
        "zero_variance_features": constant,
    }


def evaluate(records: Sequence[Dict], devig_method: str = "shin") -> Dict:
    """Score every forecaster, and score the market on the paired subset."""
    model_pairs: List[Tuple[float, bool]] = []
    elo_pairs: List[Tuple[float, bool]] = []
    base_pairs: List[Tuple[float, bool]] = []
    home_always: List[Tuple[float, bool]] = []

    paired_model: List[Tuple[float, bool]] = []
    paired_elo: List[Tuple[float, bool]] = []
    paired_market: List[Tuple[float, bool]] = []
    paired_base: List[Tuple[float, bool]] = []

    base_rate = (
        sum(1 for r in records if r["home_won"]) / len(records) if records else 0.5
    )
    unusable_odds = 0

    for record in records:
        won = bool(record["home_won"])
        model_pairs.append((record["p_home_model"], won))
        elo_pairs.append((record["p_home_elo"], won))
        base_pairs.append((base_rate, won))
        home_always.append((1.0 - 1e-9, won))

        market_prob = _market_probability(record, devig_method)
        if market_prob is None:
            unusable_odds += 1
            continue
        paired_model.append((record["p_home_model"], won))
        paired_elo.append((record["p_home_elo"], won))
        paired_market.append((market_prob, won))
        paired_base.append((base_rate, won))

    out = {
        "full_corpus": {
            "n": len(records),
            "base_rate_home": round(base_rate, 4),
            "model": mkt.summarise(model_pairs),
            "elo_only": mkt.summarise(elo_pairs),
            "constant_base_rate": mkt.summarise(base_pairs),
        },
        "paired_vs_market": {
            "n": len(paired_market),
            "unpriced_games": unusable_odds,
            "devig": devig_method,
            "market": mkt.summarise(paired_market),
            "model": mkt.summarise(paired_model),
            "elo_only": mkt.summarise(paired_elo),
            "constant_base_rate": mkt.summarise(paired_base),
        },
    }

    if paired_market:
        gap = out["paired_vs_market"]["model"]["brier"] - out["paired_vs_market"]["market"]["brier"]
        out["paired_vs_market"]["model_gap_to_market"] = round(gap, 5)
        out["paired_vs_market"]["elo_gap_to_market"] = round(
            out["paired_vs_market"]["elo_only"]["brier"]
            - out["paired_vs_market"]["market"]["brier"],
            5,
        )
        out["paired_vs_market"]["bootstrap"] = _paired_bootstrap(
            paired_model, paired_market
        )
        if gap < 0:
            logger.warning(
                "MODEL BEATS THE CLOSING LINE by %.5f Brier. Per the standing "
                "rule, this routes to 'audit the harness', not to a "
                "promotion. A model with no market features cannot do this.",
                -gap,
            )
    return out


def _market_probability(record: Dict, method: str) -> Optional[float]:
    """The market's P(home), from the moneyline if there is one, else the
    spread.

    The spread fallback matters: ESPN's older `pickcenter` rows often carry
    a spread and a total with no moneyline, and dropping them would shrink
    the market corpus to the last few seasons for no good reason. It is
    recorded as a distinct basis so the two are never silently merged.
    """
    ml_home, ml_away = record.get("ml_home"), record.get("ml_away")
    if mkt.has_complete_odds(ml_home, ml_away):
        try:
            p_home, _ = mkt.devig(float(ml_home), float(ml_away), method)
            return p_home
        except mkt.MarketError:
            return None
    spread = record.get("spread_home")
    if spread is not None:
        try:
            return mkt.spread_to_probability(float(spread))
        except (TypeError, ValueError):
            return None
    return None


def _paired_bootstrap(
    a: Sequence[Tuple[float, bool]],
    b: Sequence[Tuple[float, bool]],
    *,
    iterations: int = 2000,
    seed: int = 20260815,
) -> Dict:
    """Paired bootstrap on the Brier difference (a - b).

    Paired because the two forecasters saw the same games: the game-to-game
    variance is enormous relative to the difference between two decent
    models, and an unpaired interval would swamp a real effect.
    """
    if len(a) != len(b) or not a:
        return {}
    diffs = np.array(
        [mkt.brier_score(pa, oa) - mkt.brier_score(pb, ob) for (pa, oa), (pb, ob) in zip(a, b)]
    )
    rng = np.random.default_rng(seed)
    n = len(diffs)
    means = np.array(
        [diffs[rng.integers(0, n, n)].mean() for _ in range(iterations)]
    )
    return {
        "mean_diff": round(float(diffs.mean()), 5),
        "ci_low": round(float(np.percentile(means, 2.5)), 5),
        "ci_high": round(float(np.percentile(means, 97.5)), 5),
        "p_a_better": round(float((means < 0).mean()), 4),
        "iterations": iterations,
    }


def by_season(records: Sequence[Dict], devig_method: str) -> Dict[str, Dict]:
    out: Dict[str, Dict] = {}
    seasons = sorted({int(r["season"]) for r in records})
    for season in seasons:
        subset = [r for r in records if int(r["season"]) == season]
        model = [(r["p_home_model"], bool(r["home_won"])) for r in subset]
        market = []
        paired_model = []
        for r in subset:
            p = _market_probability(r, devig_method)
            if p is None:
                continue
            market.append((p, bool(r["home_won"])))
            paired_model.append((r["p_home_model"], bool(r["home_won"])))
        entry = {"n": len(subset), "model": mkt.summarise(model)}
        if market:
            entry["market"] = mkt.summarise(market)
            entry["paired_model"] = mkt.summarise(paired_model)
            entry["gap"] = round(
                entry["paired_model"]["brier"] - entry["market"]["brier"], 5
            )
        out[str(season)] = entry
    return out


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=2004)
    parser.add_argument("--to-season", type=int)
    parser.add_argument("--train-seasons", type=int, default=3,
                        help="seasons of warm-up before scoring begins")
    parser.add_argument("--refit-months", type=int, default=1)
    parser.add_argument("--ridge", type=float, default=1.0)
    parser.add_argument("--devig", default="shin", choices=["shin", "proportional"])
    parser.add_argument("--output", default=str(DIAGNOSTICS / "market_benchmark.json"))
    args = parser.parse_args(argv)

    rows = load_corpus(args.from_season, args.to_season)
    logger.info("corpus: %d games", len(rows))
    if not rows:
        logger.error("empty corpus — has build_warehouse run?")
        return 1

    records, meta = walk_forward(
        rows,
        train_seasons=args.train_seasons,
        refit_months=args.refit_months,
        ridge=args.ridge,
    )
    if not records:
        logger.error("nothing scored — widen the window")
        return 1

    report = evaluate(records, args.devig)
    report["harness"] = meta
    report["harness"]["from_season"] = args.from_season
    report["harness"]["train_seasons"] = args.train_seasons
    report["harness"]["refit_months"] = args.refit_months
    report["harness"]["ridge"] = args.ridge
    report["by_season"] = by_season(records, args.devig)
    report["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(".tmp")
    tmp.write_text(json.dumps(report, indent=2))
    tmp.replace(output)

    _print_table(report)
    logger.info("wrote %s", output)
    return 0


def _print_table(report: Dict) -> None:
    full = report["full_corpus"]
    paired = report["paired_vs_market"]
    print()
    print(f"FULL CORPUS  n={full['n']}  home base rate {full['base_rate_home']:.4f}")
    print(f"{'forecaster':<24}{'Brier':>9}{'log loss':>11}{'acc':>9}{'ECE':>9}")
    for label, key in (
        ("Margin model", "model"),
        ("Elo only", "elo_only"),
        ("Constant base rate", "constant_base_rate"),
    ):
        s = full[key]
        print(f"{label:<24}{s['brier']:>9.4f}{s['log_loss']:>11.4f}"
              f"{s['accuracy']:>9.4f}{s['ece']:>9.4f}")

    print()
    print(f"PAIRED vs MARKET  n={paired['n']}  ({paired['unpriced_games']} unpriced)"
          f"  de-vig={paired['devig']}")
    print(f"{'forecaster':<24}{'Brier':>9}{'log loss':>11}{'acc':>9}{'ECE':>9}{'gap':>9}")
    market_brier = paired["market"]["brier"]
    for label, key in (
        ("Market (closing)", "market"),
        ("Margin model", "model"),
        ("Elo only", "elo_only"),
        ("Constant base rate", "constant_base_rate"),
    ):
        s = paired[key]
        gap = s["brier"] - market_brier
        gap_txt = "—" if key == "market" else f"{gap:+.4f}"
        print(f"{label:<24}{s['brier']:>9.4f}{s['log_loss']:>11.4f}"
              f"{s['accuracy']:>9.4f}{s['ece']:>9.4f}{gap_txt:>9}")
    boot = paired.get("bootstrap") or {}
    if boot:
        print(f"\npaired bootstrap (model - market): {boot['mean_diff']:+.5f} "
              f"95% CI [{boot['ci_low']:+.5f}, {boot['ci_high']:+.5f}]  "
              f"p(model better) = {boot['p_a_better']:.3f}")
    print()


if __name__ == "__main__":
    sys.exit(main())
