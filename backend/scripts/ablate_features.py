"""Does a feature earn its place? Remove it and re-run the walk-forward.

    python3 -m backend.scripts.ablate_features
    python3 -m backend.scripts.ablate_features --block geography
    python3 -m backend.scripts.ablate_features --drop travel_km_home,travel_km_away

Writes `backend/data/diagnostics/ablation.json`.

**`feature_builder` has promised this script existed since the day it was
written** — its module docstring says each NBA-specific addition "is measured
in `ablate_features.py` rather than assumed". It did not exist. So the
features were assumed.

The measurement is the same rolling-origin walk-forward `benchmark_market`
runs, with named columns genuinely removed from the matrix rather than zeroed
— a zeroed column still consumes a coefficient and still shifts the ridge
penalty, so "zero it" and "never had it" are different experiments and only
one of them answers the question.

**Read the sign carefully.** `delta` is *ablated minus full*, so a POSITIVE
delta means removing the feature made Brier worse, which means the feature
was earning its keep. A negative delta means the model is better without it.

One caution this script cannot enforce: it re-fits on the same corpus it
scores over, which is exactly what the walk-forward protects against
per-game, but the ablation DECISION is still being made by looking at the
whole 23-season result. Treat a delta smaller than a few ten-thousandths as
noise, not as a finding — at n = 25,749 the standard error on a Brier
difference of this kind is around .0004.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from backend.scripts.benchmark_market import (
    evaluate,
    load_corpus,
    team_abbreviations,
    walk_forward,
)
from backend.services.prediction.feature_builder import FEATURE_NAMES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("ablate_features")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "backend" / "data" / "diagnostics" / "ablation.json"

# Named groups, because a feature rarely means anything alone. Removing
# `form_net_home` while keeping `form_net_diff` measures very little; removing
# the whole form block measures something.
BLOCKS: Dict[str, Tuple[str, ...]] = {
    "geography": (
        "travel_km_home", "travel_km_away", "altitude_delta_away", "tz_shift_away",
    ),
    "travel": ("travel_km_home", "travel_km_away"),
    "altitude": ("altitude_delta_away",),
    "timezone": ("tz_shift_away",),
    "rest": ("rest_diff", "home_b2b", "away_b2b", "home_games_in_7", "away_games_in_7"),
    "form": (
        "form_net_diff", "form_net_home", "form_net_away",
        "form_off_home", "form_off_away", "form_def_home", "form_def_away",
    ),
    "pace": ("pace_sum",),
    "elo_levels": ("elo_home", "elo_away"),
}


def run(
    rows,
    *,
    drop: Sequence[str],
    train_seasons: int,
    refit_months: int,
    ridge: float,
    abbreviations: Dict[int, str],
    devig: str,
) -> Dict:
    records, meta = walk_forward(
        rows,
        train_seasons=train_seasons,
        refit_months=refit_months,
        ridge=ridge,
        abbreviations=abbreviations,
        drop=drop,
    )
    report = evaluate(records, devig)
    full = report["full_corpus"]["model"]
    paired = (report.get("paired_vs_market") or {}).get("model") or {}
    continuous = report.get("continuous") or {}
    return {
        "dropped": sorted(drop),
        "n_features": meta["n_feature_rows"] and len(FEATURE_NAMES) - len(set(drop)),
        "n_scored": meta["n_scored"],
        "brier": full["brier"],
        "log_loss": full["log_loss"],
        "accuracy": full["accuracy"],
        "ece": full["ece"],
        "paired_brier": paired.get("brier"),
        "margin_mae": ((continuous.get("margin") or {}).get("model") or {}).get("mae"),
        "total_mae": ((continuous.get("total") or {}).get("model") or {}).get("mae"),
        "zero_variance": meta.get("zero_variance_features") or [],
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=2004)
    parser.add_argument("--to-season", type=int)
    parser.add_argument("--train-seasons", type=int, default=3)
    parser.add_argument("--refit-months", type=int, default=1)
    parser.add_argument("--ridge", type=float, default=1.0)
    parser.add_argument("--devig", default="shin", choices=["shin", "proportional"])
    parser.add_argument(
        "--block",
        action="append",
        help=f"a named block to ablate; repeatable. one of: {', '.join(sorted(BLOCKS))}",
    )
    parser.add_argument("--drop", help="comma-separated feature names, ablated together")
    parser.add_argument("--output", default=str(OUT_PATH))
    args = parser.parse_args(argv)

    experiments: List[Tuple[str, Tuple[str, ...]]] = []
    if args.drop:
        names = tuple(n.strip() for n in args.drop.split(",") if n.strip())
        experiments.append(("custom", names))
    for name in args.block or []:
        if name not in BLOCKS:
            raise SystemExit(f"unknown block {name!r}; known: {sorted(BLOCKS)}")
        experiments.append((name, BLOCKS[name]))
    if not experiments:
        experiments = sorted(BLOCKS.items())

    rows = load_corpus(args.from_season, args.to_season)
    if not rows:
        logger.error("empty corpus — has build_warehouse run?")
        return 1
    abbreviations = team_abbreviations()

    logger.info("baseline: the full %d-feature vector", len(FEATURE_NAMES))
    baseline = run(
        rows, drop=(), train_seasons=args.train_seasons,
        refit_months=args.refit_months, ridge=args.ridge,
        abbreviations=abbreviations, devig=args.devig,
    )

    results = []
    for name, names in experiments:
        logger.info("ablating %s (%d features)", name, len(names))
        scored = run(
            rows, drop=names, train_seasons=args.train_seasons,
            refit_months=args.refit_months, ridge=args.ridge,
            abbreviations=abbreviations, devig=args.devig,
        )
        scored["block"] = name
        # Ablated minus full: POSITIVE means removing it hurt, so the block
        # was earning its keep.
        scored["delta_brier"] = round(scored["brier"] - baseline["brier"], 6)
        scored["delta_log_loss"] = round(scored["log_loss"] - baseline["log_loss"], 6)
        scored["delta_margin_mae"] = (
            round(scored["margin_mae"] - baseline["margin_mae"], 4)
            if scored["margin_mae"] and baseline["margin_mae"] else None
        )
        scored["verdict"] = _verdict(scored["delta_brier"])
        results.append(scored)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": (
            "delta = ablated minus full. POSITIVE means removing the block "
            "made the model worse, i.e. the block earns its place. Anything "
            "inside +/-.0004 is noise at this sample size."
        ),
        "noise_floor": NOISE_FLOOR,
        "baseline": baseline,
        "features": list(FEATURE_NAMES),
        "results": sorted(results, key=lambda r: -r["delta_brier"]),
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2))
    logger.info("wrote %s", output)

    _print(report)
    return 0


# Roughly the standard error on a paired Brier difference at n ~ 25,000. A
# delta inside this band is not evidence of anything, in either direction.
NOISE_FLOOR = 0.0004


def _verdict(delta: float) -> str:
    if delta > NOISE_FLOOR:
        return "earns_its_place"
    if delta < -NOISE_FLOOR:
        return "model_is_better_without_it"
    return "no_measurable_effect"


def _print(report: Dict) -> None:
    base = report["baseline"]
    print()
    print(f"BASELINE  full vector, {len(report['features'])} features, "
          f"n={base['n_scored']}")
    print(f"  Brier {base['brier']:.6f}   log loss {base['log_loss']:.6f}   "
          f"margin MAE {base['margin_mae']:.3f}")
    print()
    print(f"{'ablated block':<14}{'Brier':>11}{'delta':>11}{'margin MAE':>12}"
          f"{'  verdict'}")
    for row in report["results"]:
        print(f"{row['block']:<14}{row['brier']:>11.6f}{row['delta_brier']:>+11.6f}"
              f"{row['margin_mae']:>12.3f}  {row['verdict']}")
    print()
    print(f"  positive delta = removing it hurt = it earns its place")
    print(f"  anything inside +/-{NOISE_FLOOR} is noise")
    print()


if __name__ == "__main__":
    sys.exit(main())
