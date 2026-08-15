"""Backtest the playoff-series model against the baselines it must beat.

    python3 -m backend.scripts.benchmark_series

Writes `backend/data/diagnostics/series_model.json`.

Rolling origin: for each postseason, ratings are built from every game
played before it and the series in it are scored. No series is ever
predicted by a model that saw it, and no season is predicted by a model that
saw a later one.

**Calibration is the result worth quoting, not the accuracy.** Accuracy on
playoff series is bounded by how often the better team actually wins, which
is a fact about the NBA rather than about any model. What a bracket
simulation consumes is a probability that means what it says, and that is
what the reliability table below measures.

The ladder, as in the sibling soccer project, is read as a GAP rather than
as levels:

* coin flip — the floor
* higher seed advances — the naive rule everyone already knows
* home-court/Elo — the structural baseline
* the series model — has to beat all three or it does not serve
"""

from __future__ import annotations

import argparse
import json
import logging
import math
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
from backend.services.playoffs.series import (
    assign_depth,
    build_series,
    pattern_for,
    series_length_distribution,
    series_probability,
)
from backend.services.prediction import market as mkt
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import EloConfig, EloRatingSystem

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("benchmark_series")

ROOT = Path(__file__).resolve().parent.parent.parent
DIAGNOSTICS = ROOT / "backend" / "data" / "diagnostics"


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=2007)
    parser.add_argument("--output", default=str(DIAGNOSTICS / "series_model.json"))
    args = parser.parse_args(argv)

    warehouse = get_warehouse()
    franchises = {
        int(r["team_id"])
        for r in warehouse.conn.execute(
            "SELECT team_id FROM teams WHERE conference IS NOT NULL"
        )
    }

    all_games = [
        r
        for r in warehouse.iter_games(
            season_types=(SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)
        )
        if int(r["home_team_id"]) in franchises and int(r["away_team_id"]) in franchises
    ]
    playoff_games = [
        r for r in all_games if int(r["season_type"]) == SEASON_TYPE_POSTSEASON
    ]
    series = build_series(playoff_games)
    assign_depth(series)
    resolved = [s for s in series if s.completed and s.season >= args.from_season]
    logger.info(
        "%d series reconstructed, %d resolved from %s onward",
        len(series), len(resolved), args.from_season,
    )

    # A progression check: does the team the resolver says advanced actually
    # appear in the next round? This is the integrity gate — a mis-paired
    # series trains the model on the losing side and is otherwise invisible.
    progression = _validate_progression(series)
    logger.info(
        "progression check: %d/%d = %.1f%%",
        progression["consistent"], progression["checked"],
        100.0 * progression["rate"] if progression["checked"] else 0.0,
    )

    raw_pairs: List[Tuple[float, bool]] = []
    model_pairs: List[Tuple[float, bool]] = []
    seed_pairs: List[Tuple[float, bool]] = []
    elo_game_pairs: List[Tuple[float, bool]] = []
    coin_pairs: List[Tuple[float, bool]] = []
    fitted_params: Dict[int, Dict] = {}
    per_depth: Dict[int, List[Tuple[float, bool]]] = defaultdict(list)
    per_season: Dict[int, List[Tuple[float, bool]]] = defaultdict(list)
    length_hits = 0
    length_n = 0

    by_season: Dict[int, List] = defaultdict(list)
    for item in resolved:
        by_season[item.season].append(item)

    margin_model = MarginModel()

    # Rolling-origin training set for the playoff-specific parameters:
    # (elo difference, home-court pattern, outcome) for every series ALREADY
    # resolved before the season being scored.
    history: List[Tuple[float, Tuple[bool, ...], int, bool]] = []

    for season in sorted(by_season):
        # Rate everything strictly before this postseason.
        cutoff = min(s.first_game_utc for s in by_season[season] if s.first_game_utc)
        elo = EloRatingSystem(EloConfig())
        elo.run([g for g in all_games if g["date_utc"] < cutoff])

        # **Fitted on earlier postseasons only.** Regular-season Elo is the
        # wrong scale for playoff basketball — rotations shorten, stars play
        # more minutes, and the better team separates further than its
        # regular-season rating implies. Feeding raw regular-season
        # probabilities into the series enumeration produced a model that
        # said 44.5% about series the higher seed won 67.6% of the time.
        #
        # Two parameters, both out-of-sample: how many rating points a point
        # of playoff margin is worth, and how big home court is in April.
        params = _fit_playoff_params(history)
        fitted_params[season] = {**params, "trained_on": len(history)}

        for item in by_season[season]:
            higher, lower = item.team_a_id, item.team_b_id
            elo_high = elo.get(higher)
            elo_low = elo.get(lower)
            pattern = pattern_for(item.season, item.depth)
            higher_won = item.winner_id == higher

            # Uncalibrated: the regular-season model, kept as the thing the
            # calibrated version has to beat.
            raw_home = margin_model.predict_from_elo(
                elo_high, elo_low, home_advantage_elo=elo.config.home_advantage
            ).p_home
            raw_away = 1.0 - margin_model.predict_from_elo(
                elo_low, elo_high, home_advantage_elo=elo.config.home_advantage
            ).p_home
            raw_series = series_probability(
                raw_home, raw_away, best_of=item.best_of, pattern=pattern
            )
            raw_pairs.append((raw_series, higher_won))

            p_home_game = _game_probability(
                elo_high - elo_low, params["home_advantage"], params["scale"]
            )
            p_away_game = _game_probability(
                elo_high - elo_low, -params["home_advantage"], params["scale"]
            )
            p_series = series_probability(
                p_home_game, p_away_game, best_of=item.best_of, pattern=pattern
            )

            model_pairs.append((p_series, higher_won))
            history.append(
                (elo_high - elo_low, pattern, item.best_of, higher_won)
            )
            # "The higher seed advances" — the naive rule. Expressed as a
            # probability at the observed base rate so it can be scored with
            # the same proper scoring rule rather than only on accuracy.
            seed_pairs.append((0.5, higher_won))
            # A genuine single-game baseline: the regular-season model's
            # probability for game 1, used as if it were the series answer.
            # It exists to show what the series enumeration is worth, so it
            # must NOT be fed the playoff-fitted parameters.
            elo_game_pairs.append((raw_home, higher_won))
            coin_pairs.append((0.5, higher_won))
            per_depth[item.depth if item.depth is not None else -1].append(
                (p_series, higher_won)
            )
            per_season[item.season].append((p_series, higher_won))

            lengths = series_length_distribution(
                p_home_game, p_away_game, best_of=item.best_of, pattern=pattern
            )
            predicted = max(lengths, key=lengths.get)
            actual_side = "higher" if higher_won else "lower"
            actual = f"{actual_side}_in_{item.games_played}"
            length_n += 1
            if predicted == actual:
                length_hits += 1

    if not model_pairs:
        logger.error("no resolved series to score")
        return 1

    base_rate = sum(1 for _, won in model_pairs if won) / len(model_pairs)
    seed_pairs = [(base_rate, won) for _, won in seed_pairs]

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "from_season": args.from_season,
        "n_series": len(model_pairs),
        "higher_seed_win_rate": round(base_rate, 4),
        "progression_check": progression,
        "ladder": {
            "coin_flip": mkt.summarise(coin_pairs),
            "higher_seed_base_rate": mkt.summarise(seed_pairs),
            "single_game_elo": mkt.summarise(elo_game_pairs),
            "series_regular_season_params": mkt.summarise(raw_pairs),
            "series_model": mkt.summarise(model_pairs),
        },
        "fitted_params_by_season": {
            str(k): v for k, v in sorted(fitted_params.items())
        },
        "significance": {
            "model_vs_seed_baseline": _paired_bootstrap(model_pairs, seed_pairs),
            "model_vs_regular_season_fit": _paired_bootstrap(model_pairs, raw_pairs),
        },
        "reliability": [
            b.as_dict() for b in mkt.reliability_table(model_pairs, bins=8)
        ],
        "by_depth": {
            _depth_name(depth): mkt.summarise(pairs)
            for depth, pairs in sorted(per_depth.items())
        },
        "by_season": {
            str(season): mkt.summarise(pairs)
            for season, pairs in sorted(per_season.items())
        },
        "series_length": {
            "n": length_n,
            "modal_length_hit_rate": round(length_hits / length_n, 4) if length_n else 0,
        },
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_suffix(".tmp")
    tmp.write_text(json.dumps(report, indent=2))
    tmp.replace(output)

    _print(report)
    logger.info("wrote %s", output)
    return 0


def _paired_bootstrap(
    a: Sequence[Tuple[float, bool]],
    b: Sequence[Tuple[float, bool]],
    *,
    iterations: int = 2000,
    seed: int = 20260815,
) -> Dict:
    """Paired bootstrap on the Brier difference (a - b). Negative favours a.

    Load-bearing at this sample size. 300 series is a small corpus and the
    spread between every forecaster here is a few thousandths of a Brier —
    without an interval it is impossible to tell a real improvement from
    the ordering noise of one postseason.
    """
    if len(a) != len(b) or not a:
        return {}
    diffs = np.array(
        [mkt.brier_score(pa, oa) - mkt.brier_score(pb, ob)
         for (pa, oa), (pb, ob) in zip(a, b)]
    )
    rng = np.random.default_rng(seed)
    n = len(diffs)
    means = np.array([diffs[rng.integers(0, n, n)].mean() for _ in range(iterations)])
    return {
        "mean_diff": round(float(diffs.mean()), 5),
        "ci_low": round(float(np.percentile(means, 2.5)), 5),
        "ci_high": round(float(np.percentile(means, 97.5)), 5),
        "p_a_better": round(float((means < 0).mean()), 4),
        "significant": bool(
            np.percentile(means, 2.5) > 0 or np.percentile(means, 97.5) < 0
        ),
    }


def _game_probability(elo_diff: float, home_advantage: float, scale: float) -> float:
    """One playoff game, from the rating gap. Logistic on the Elo scale."""
    return 1.0 / (1.0 + 10.0 ** (-(elo_diff + home_advantage) / scale))


# Sensible starting point before any postseason has been observed: the
# regular-season scale and a home advantage in the middle of the measured
# era range. The first scored season uses these and nothing else, which is
# the honest cost of refusing to look forward.
_PRIOR_PARAMS = {"scale": 400.0, "home_advantage": 50.0}


def _fit_playoff_params(
    history: Sequence[Tuple[float, Tuple[bool, ...], int, bool]],
    *,
    minimum: int = 30,
) -> Dict[str, float]:
    """Maximum-likelihood fit of (scale, home_advantage) on past series.

    Scored on SERIES outcomes rather than game outcomes, because the series
    is the thing being predicted and the enumeration is what connects the
    two. A coarse grid is enough: the likelihood surface in two parameters
    over a few hundred series is smooth and shallow, and a finer search
    would be fitting noise.

    Returns the prior unchanged below `minimum` observations rather than a
    number a handful of series cannot support.
    """
    if len(history) < minimum:
        return dict(_PRIOR_PARAMS)

    best = dict(_PRIOR_PARAMS)
    best_ll = -float("inf")
    for scale in (250.0, 300.0, 350.0, 400.0, 450.0, 500.0):
        for home_advantage in (40.0, 60.0, 80.0, 100.0, 120.0, 140.0):
            total = 0.0
            for elo_diff, pattern, best_of, higher_won in history:
                p_home = _game_probability(elo_diff, home_advantage, scale)
                p_away = _game_probability(elo_diff, -home_advantage, scale)
                p = series_probability(
                    p_home, p_away, best_of=best_of, pattern=pattern
                )
                p = min(max(p, 1e-9), 1 - 1e-9)
                total += math.log(p if higher_won else 1.0 - p)
            if total > best_ll:
                best_ll = total
                best = {"scale": scale, "home_advantage": home_advantage}
    return best


def _depth_name(depth: int) -> str:
    return {
        0: "finals",
        1: "conference-finals",
        2: "conference-semifinals",
        3: "first-round",
        -1: "unassigned",
    }.get(depth, f"depth-{depth}")


def _validate_progression(series: Sequence) -> Dict:
    """Does the winner of a series appear in the next round?

    The integrity gate for this layer. A wrong winner trains the model on
    the losing side and nothing else would catch it.
    """
    by_season: Dict[int, List] = defaultdict(list)
    for item in series:
        if item.completed:
            by_season[item.season].append(item)

    checked = consistent = 0
    failures: List[str] = []
    for season, members in by_season.items():
        members.sort(key=lambda s: s.first_game_utc or "")
        by_depth: Dict[Optional[int], List] = defaultdict(list)
        for item in members:
            by_depth[item.depth].append(item)
        # Depth counts down toward the final: 3 → 2 → 1 → 0.
        for depth in (3, 2, 1):
            current = by_depth.get(depth) or []
            nxt = by_depth.get(depth - 1) or []
            if not current or not nxt:
                continue
            entrants = set()
            for item in nxt:
                entrants.add(item.team_a_id)
                entrants.add(item.team_b_id)
            for item in current:
                checked += 1
                if item.winner_id in entrants:
                    consistent += 1
                else:
                    failures.append(
                        f"{season} depth {depth}: winner {item.winner_id} of "
                        f"{item.series_id} is absent from the next round"
                    )
    return {
        "checked": checked,
        "consistent": consistent,
        "rate": round(consistent / checked, 4) if checked else None,
        "failures": failures[:10],
    }


def _print(report: Dict) -> None:
    print()
    print(f"PLAYOFF SERIES  n={report['n_series']}  "
          f"higher seed advances {report['higher_seed_win_rate']:.1%}")
    print(f"{'forecaster':<28}{'Brier':>9}{'log loss':>11}{'acc':>9}{'ECE':>9}")
    for label, key in (
        ("Coin flip", "coin_flip"),
        ("Higher seed (base rate)", "higher_seed_base_rate"),
        ("Single-game Elo", "single_game_elo"),
        ("Series, regular-season fit", "series_regular_season_params"),
        ("Series model (playoff fit)", "series_model"),
    ):
        s = report["ladder"][key]
        print(f"{label:<28}{s['brier']:>9.4f}{s['log_loss']:>11.4f}"
              f"{s['accuracy']:>9.4f}{s['ece']:>9.4f}")

    print("\ncalibration (says / happens):")
    for bucket in report["reliability"]:
        print(f"   {bucket['mean_predicted']:.1%} → {bucket['observed']:.1%}"
              f"   (n={bucket['count']})")

    print("\nby round:")
    for name, stats in report["by_depth"].items():
        print(f"   {name:<24} n={stats['n']:>4}  Brier {stats['brier']:.4f}  "
              f"acc {stats['accuracy']:.3f}")

    print("\nsignificance (paired bootstrap, negative favours the series model):")
    for label, key in (
        ("vs higher-seed base rate", "model_vs_seed_baseline"),
        ("vs regular-season fit", "model_vs_regular_season_fit"),
    ):
        b = report["significance"].get(key) or {}
        if b:
            verdict = "SIGNIFICANT" if b["significant"] else "not significant"
            print(f"   {label:<28}{b['mean_diff']:+.5f}  "
                  f"95% CI [{b['ci_low']:+.5f}, {b['ci_high']:+.5f}]  {verdict}")

    prog = report["progression_check"]
    if prog["checked"]:
        print(f"\nprogression check: {prog['consistent']}/{prog['checked']} = "
              f"{prog['rate']:.1%}")
    length = report["series_length"]
    print(f"modal series length correct: {length['modal_length_hit_rate']:.1%} "
          f"of {length['n']}")
    print()


if __name__ == "__main__":
    sys.exit(main())
