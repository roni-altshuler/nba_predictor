"""The live published record, and closing line value.

    python3 -m backend.scripts.score_live
    python3 -m backend.scripts.score_live --season 2027

Writes `backend/data/diagnostics/live_record.json`.

**This is the only honest live record this project can produce, and it exists
only because `forecast_season` stamps every forecast before its tip-off** —
into the warehouse for the full drift history, and into a committed
`forecast_log.json` for the first call on each fixture, which is the copy that
survives the warehouse being rebuilt.

Everything on `/accuracy` today is a walk-forward: the model is refitted on
games strictly earlier than the one it scores, so it never sees the answer —
but nobody read those numbers before those tip-offs either. That is a
backtest, it is labelled a backtest everywhere it appears, and no amount of
methodological care converts it into a published record.

What this script scores is different in exactly one way that cannot be
recovered after the fact: **the number was on the internet before the ball
went up.** `earliest_predictions` takes the FIRST snapshot written strictly
before tipoff, which is the hardest version of the claim — furthest from the
game, least information, and impossible to accuse of having drifted toward
the closing line.

Three consequences the output states rather than hides:

1. **It starts at n = 0 and is reported at whatever n it has reached.** A
   record over eleven games is a record over eleven games. The interval is
   published beside it and it is enormous at first; that is the truth of the
   situation, not a defect in the presentation.
2. **It is never merged with the historical walk-forward.** Different
   epistemic status, different table, and `/accuracy` keeps them apart.
3. **Nothing is claimed until the interval says something.** `verdict` is
   `"insufficient"` until the paired bootstrap against the market excludes
   zero, and the site prints that word.

Closing line value
------------------
CLV is scored here rather than profit, and the distinction matters at this
sample size. Profit over a few hundred bets is dominated by variance and says
almost nothing about whether an edge existed; CLV — did the price move toward
us between the call and the close — converges far faster, because the noise
term is the result and CLV does not contain it.

It is computed only on games the value surface actually FLAGGED, reconstructed
from the stored snapshot rather than re-derived from today's model: the side
is `argmax` of the two edges against the de-vigged price that was stored
alongside the forecast, and the flag threshold is the `MIN_EDGE` in force.
Scoring CLV on every game would measure the market's drift, not ours.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.espn.client import current_season
from backend.services.prediction import market as mkt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("score_live")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "backend" / "data" / "diagnostics"
# The committed, durable copy of what was published in advance. See
# `forecast_season.append_forecast_log` for why it is not only in the
# warehouse.
LOG_PATH = ROOT / "backend" / "data" / "predictions" / "forecast_log.json"

SCORED_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)

# Must match `forecast_season.MIN_EDGE`. Imported rather than repeated would
# be cleaner, except that the threshold in force when a call was made is a
# property of that call — if it is ever raised, every historical flag must
# still be scored against the threshold it was published under. Stored per
# record for exactly that reason.
DEFAULT_MIN_EDGE = 0.02


def settled_games(warehouse, season: int) -> Dict[str, Dict]:
    """Every played game this season, keyed by id.

    The NBA Cup Championship is **kept** here, unlike in `current_standings`.
    The two exclusions answer different questions: the league does not count
    that game in the standings, but a forecast of it was still a forecast
    somebody could have read, and a record that quietly drops the one game it
    got wrong is not a record.
    """
    out: Dict[str, Dict] = {}
    for row in warehouse.iter_games(seasons=[season], season_types=SCORED_TYPES):
        out[str(row["game_id"])] = {
            "game_id": str(row["game_id"]),
            "date_utc": row["date_utc"],
            "home_score": int(row["home_score"]),
            "away_score": int(row["away_score"]),
            "home_won": int(row["home_score"]) > int(row["away_score"]),
            "margin": int(row["home_score"]) - int(row["away_score"]),
            "total": int(row["home_score"]) + int(row["away_score"]),
            "ml_home": row["ml_home"],
            "ml_away": row["ml_away"],
            "spread_home": row["spread_home"],
            "total_points": row["total_points"],
        }
    return out


def earliest_forecasts(warehouse, season: int, log_path: Path) -> List[Dict]:
    """Every fixture's first pre-tipoff forecast, from both stores.

    **The committed log wins on conflict, and that ordering is the point.**
    The warehouse is derived data: gitignored, restored each morning from a
    release asset, and rebuilt from scratch by the daily job if that download
    fails. Results and prices survive a rebuild because ESPN still has them.
    A forecast made before a game does not survive anything, so it is also
    written to a file in git, and that file is the authority.

    Merged rather than either-or so that a warehouse carrying rows the log
    predates still contributes them.
    """
    merged: Dict[str, Dict] = {}
    for row in warehouse.earliest_predictions(season=season):
        merged[str(row["fixture_uid"])] = {
            "fixture_uid": str(row["fixture_uid"]),
            "generated_at": row["generated_at"],
            "model_version": row["model_version"],
            "tipoff_utc": row["tipoff_utc"],
            "home_team": row["home_team"],
            "away_team": row["away_team"],
            "p_home": row["p_home"],
            "exp_margin": row["exp_margin"],
            "exp_total": row["exp_total"],
            "taken_ml_home": None,
            "taken_ml_away": None,
        }

    for game_id, entry in _read_log(log_path).items():
        if entry.get("season") not in (None, season):
            continue
        tipoff, generated = entry.get("tipoff_utc"), entry.get("generated_at")
        if not tipoff or not generated or str(generated) >= str(tipoff):
            continue
        existing = merged.get(game_id)
        # Keep whichever is genuinely earlier. The log should always be the
        # earlier of the two, but "should" is not a guarantee and taking the
        # later of two pre-tipoff forecasts would weaken the claim silently.
        if existing and str(existing["generated_at"]) < str(generated):
            existing["taken_ml_home"] = entry.get("ml_home")
            existing["taken_ml_away"] = entry.get("ml_away")
            continue
        merged[game_id] = {
            "fixture_uid": game_id,
            "generated_at": generated,
            "model_version": entry.get("model_version"),
            "tipoff_utc": tipoff,
            "home_team": entry.get("home_team"),
            "away_team": entry.get("away_team"),
            "p_home": entry.get("p_home"),
            "exp_margin": entry.get("exp_margin"),
            "exp_total": entry.get("exp_total"),
            "taken_ml_home": entry.get("ml_home"),
            "taken_ml_away": entry.get("ml_away"),
        }

    return sorted(merged.values(), key=lambda r: (r["tipoff_utc"] or "", r["fixture_uid"]))


def _read_log(path: Path) -> Dict[str, Dict]:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    forecasts = payload.get("forecasts") if isinstance(payload, dict) else None
    return forecasts if isinstance(forecasts, dict) else {}


def join(
    warehouse, season: int, devig: str = "shin", log_path: Optional[Path] = None
) -> List[Dict]:
    """Settled games joined to the earliest pre-tipoff forecast of each.

    A game with no forecast is not scored and is not an omission worth
    apologising for: it means the fixture was played before this pipeline
    ever published a forecast for it, which is true of everything before the
    provenance table started being written.
    """
    results = settled_games(warehouse, season)
    taken = warehouse.earliest_odds(provider="publish")

    records: List[Dict] = []
    for snapshot in earliest_forecasts(
        warehouse, season, log_path or LOG_PATH
    ):
        game_id = str(snapshot["fixture_uid"])
        result = results.get(game_id)
        if result is None or snapshot["p_home"] is None:
            continue

        record = {
            "game_id": game_id,
            "tipoff_utc": snapshot["tipoff_utc"],
            "generated_at": snapshot["generated_at"],
            "model_version": snapshot["model_version"],
            "home_team": snapshot["home_team"],
            "away_team": snapshot["away_team"],
            "lead_hours": _hours_between(
                snapshot["generated_at"], snapshot["tipoff_utc"]
            ),
            "p_home": float(snapshot["p_home"]),
            "exp_margin": _opt_float(snapshot["exp_margin"]),
            "exp_total": _opt_float(snapshot["exp_total"]),
            **{k: v for k, v in result.items() if k != "game_id"},
        }

        # The price stored beside the forecast. Warehouse first because it is
        # the richer row; the log carries the same two legs as a fallback for
        # exactly the rebuild case the log exists for.
        price = taken.get(game_id)
        if price is None and snapshot.get("taken_ml_home") is not None:
            price = {
                "ml_home": snapshot["taken_ml_home"],
                "ml_away": snapshot["taken_ml_away"],
            }
        record["clv"] = _clv(record, price, devig)
        records.append(record)
    return records


def _clv(
    record: Dict, taken_row, devig: str
) -> Optional[Dict]:
    """Closing line value on the side the model preferred, or None.

    **None means absent data, never "no edge".** It is returned in exactly
    two situations, both of which are missing facts: no price was stored when
    the call was made, or no closing price exists to compare it against.

    A call whose edge never cleared the publication threshold is a different
    thing entirely and comes back as a full row with `flagged: False`. That
    is a decision this project made, not a hole in the data, and collapsing
    the two into one `None` would make the CLV summary unable to tell
    "we passed on this" from "we never saw a price" — which is the same
    distinction the value surface itself refuses to blur.
    """
    if taken_row is None:
        return None
    if not mkt.has_complete_odds(taken_row["ml_home"], taken_row["ml_away"]):
        return None
    if not mkt.has_complete_odds(record.get("ml_home"), record.get("ml_away")):
        return None

    try:
        fair_home, fair_away = mkt.devig(
            float(taken_row["ml_home"]), float(taken_row["ml_away"]), devig
        )
        taken_home = mkt.american_to_decimal(float(taken_row["ml_home"]))
        taken_away = mkt.american_to_decimal(float(taken_row["ml_away"]))
        close_home = mkt.american_to_decimal(float(record["ml_home"]))
        close_away = mkt.american_to_decimal(float(record["ml_away"]))
    except mkt.MarketError:
        return None

    p_home = record["p_home"]
    edge_home = p_home - fair_home
    edge_away = (1.0 - p_home) - fair_away
    side = "home" if edge_home >= edge_away else "away"
    edge = max(edge_home, edge_away)

    taken_price = taken_home if side == "home" else taken_away
    close_price = close_home if side == "home" else close_away
    won = record["home_won"] if side == "home" else not record["home_won"]

    return {
        "side": side,
        "edge": round(edge, 4),
        "flagged": edge >= DEFAULT_MIN_EDGE,
        "min_edge": DEFAULT_MIN_EDGE,
        "taken_decimal": round(taken_price, 4),
        "closing_decimal": round(close_price, 4),
        "clv": round(mkt.closing_line_value(taken_price, close_price), 5),
        "beat_close": taken_price > close_price,
        "won": bool(won),
        "profit": round(taken_price - 1.0 if won else -1.0, 4),
    }


def evaluate(records: Sequence[Dict], devig: str = "shin") -> Dict:
    """Score the live record on the same rules the historical benchmark uses.

    Deliberately the same functions, not a parallel implementation: a live
    Brier computed by different code than the backtest Brier is not
    comparable to it, and the entire purpose of this artifact is that the two
    can be read side by side.
    """
    model_pairs = [(r["p_home"], r["home_won"]) for r in records]

    paired_model: List[Tuple[float, bool]] = []
    paired_market: List[Tuple[float, bool]] = []
    for record in records:
        price = _market_probability(record, devig)
        if price is None:
            continue
        paired_model.append((record["p_home"], record["home_won"]))
        paired_market.append((price, record["home_won"]))

    margin_pairs = [
        (r["exp_margin"], r["margin"]) for r in records if r["exp_margin"] is not None
    ]
    total_pairs = [
        (r["exp_total"], r["total"]) for r in records if r["exp_total"] is not None
    ]

    out: Dict = {
        "n": len(records),
        "basis": "live",
        "note": (
            "Every forecast below was written to the warehouse before its "
            "tip-off, and this is the earliest such forecast for each game. "
            "It is NOT the walk-forward on the same page and the two are "
            "never merged."
        ),
        "first_tipoff": min((r["tipoff_utc"] for r in records), default=None),
        "last_tipoff": max((r["tipoff_utc"] for r in records), default=None),
        "median_lead_hours": _median(
            [r["lead_hours"] for r in records if r["lead_hours"] is not None]
        ),
        "model": mkt.summarise(model_pairs),
        "margin": mkt.summarise_continuous(margin_pairs),
        "total": mkt.summarise_continuous(total_pairs),
    }

    if paired_market:
        boot = _paired_bootstrap(paired_model, paired_market)
        out["paired_vs_market"] = {
            "n": len(paired_market),
            "devig": devig,
            "model": mkt.summarise(paired_model),
            "market": mkt.summarise(paired_market),
            "gap_to_market": round(
                mkt.summarise(paired_model)["brier"]
                - mkt.summarise(paired_market)["brier"],
                5,
            ),
            "bootstrap": boot,
            "verdict": _verdict(boot, len(paired_market)),
        }
    else:
        out["paired_vs_market"] = {
            "n": 0,
            "verdict": "insufficient",
            "reason": "no settled game carries both a stored forecast and a price",
        }

    out["clv"] = _clv_summary(records)
    return out


def _verdict(boot: Dict, n: int) -> str:
    """What may be claimed, in one word the page prints verbatim.

    `insufficient` until the interval excludes zero. The bar is deliberately
    the same in both directions: a live record that looks better than the
    market on 40 games has not beaten the market, it has had a good month,
    and this project's standing rule is that a challenger appearing to beat
    the closing line is evidence of a harness bug before it is evidence of an
    edge.
    """
    if n < 30:
        return "insufficient"
    low, high = boot.get("ci_low"), boot.get("ci_high")
    if low is None or high is None:
        return "insufficient"
    if low > 0:
        return "market_better"
    if high < 0:
        return "model_better_suspect_the_harness"
    return "indistinguishable"


def _clv_summary(records: Sequence[Dict]) -> Dict:
    """Beat-the-close on the flagged calls only.

    Both the flagged subset and the full priced set are reported. The second
    is context, not a claim: it measures how the market moved on games we had
    an opinion about, which is a different question from whether our opinion
    was worth acting on.
    """
    priced = [r["clv"] for r in records if r.get("clv")]
    flagged = [c for c in priced if c["flagged"]]

    def block(rows: Sequence[Dict]) -> Dict:
        if not rows:
            return {"n": 0, "verdict": "insufficient"}
        values = [row["clv"] for row in rows]
        n = len(values)
        wins = sum(1 for row in rows if row["won"])
        interval = _bootstrap_mean(values)
        return {
            "n": n,
            "mean_clv": round(sum(values) / n, 5),
            "median_clv": round(_median(values) or 0.0, 5),
            "ci_low": interval[0],
            "ci_high": interval[1],
            "beat_close_rate": round(
                sum(1 for row in rows if row["beat_close"]) / n, 4
            ),
            "record": f"{wins}-{n - wins}",
            "roi": round(sum(row["profit"] for row in rows) / n, 5),
            "verdict": _clv_verdict(n, interval),
        }

    return {
        "flagged": block(flagged),
        "all_priced": block(priced),
        "min_n": CLV_MIN_N,
        "note": (
            "CLV, not profit, is the headline. At this sample size realised "
            "return is dominated by variance and says close to nothing about "
            "whether an edge existed; whether the price moved toward us "
            "converges far sooner. ROI is printed for completeness and should "
            "not be read as a result."
        ),
    }


# Below this the value surface is not being graded, in either direction.
# CLV converges far faster than realised profit but it is still a mean of a
# noisy quantity, and a hundred calls is where the interval starts to be
# narrower than the effect anyone would act on.
CLV_MIN_N = 100


def _clv_verdict(n: int, interval: Tuple[Optional[float], Optional[float]]) -> str:
    """Whether the value surface has earned the right to keep flagging.

    **This is the one number on the site that grades the site.** Every other
    measurement asks whether a forecast was accurate; this asks whether the
    edges it published were real enough to have been worth acting on, and it
    is allowed to come back negative.

    `negative_stop_flagging` is a genuine verdict, not a decoration: if the
    interval on mean CLV sits entirely below zero over a hundred flagged
    calls, the market moved AWAY from us on the games we claimed an edge, and
    `MIN_EDGE` is not protecting anybody. The page says so in those words
    rather than continuing to publish flags beside a quiet failure.
    """
    low, high = interval
    if n < CLV_MIN_N or low is None or high is None:
        return "insufficient"
    if high < 0:
        return "negative_stop_flagging"
    if low > 0:
        return "positive"
    return "indistinguishable"


def _bootstrap_mean(
    values: Sequence[float], *, iterations: int = 4000, seed: int = 23
) -> Tuple[Optional[float], Optional[float]]:
    """A 95% interval on the mean, resampled. Fixed seed, so it does not
    wander when nothing about the data did."""
    if len(values) < 2:
        return (None, None)
    rng = random.Random(seed)
    n = len(values)
    means = sorted(
        sum(values[rng.randrange(n)] for _ in range(n)) / n
        for _ in range(iterations)
    )
    return (
        round(means[int(0.025 * iterations)], 5),
        round(means[int(0.975 * iterations) - 1], 5),
    )


def _market_probability(record: Dict, method: str) -> Optional[float]:
    """The closing no-vig home probability, moneyline first, spread second."""
    if mkt.has_complete_odds(record.get("ml_home"), record.get("ml_away")):
        try:
            return mkt.devig(
                float(record["ml_home"]), float(record["ml_away"]), method
            )[0]
        except mkt.MarketError:
            pass
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
    iterations: int = 5000,
    seed: int = 17,
) -> Dict:
    """Bootstrap the Brier difference, resampling GAMES not forecasters.

    Same procedure as `benchmark_market`, and the seed is fixed so that a
    number on the page does not move when nothing about the model did.
    """
    if not a:
        return {}
    diffs = [
        mkt.brier_score(pa, oa) - mkt.brier_score(pb, ob)
        for (pa, oa), (pb, ob) in zip(a, b)
    ]
    n = len(diffs)
    rng = random.Random(seed)
    means = []
    for _ in range(iterations):
        means.append(
            sum(diffs[rng.randrange(n)] for _ in range(n)) / n
        )
    means.sort()
    return {
        "mean_diff": round(sum(diffs) / n, 5),
        "ci_low": round(means[int(0.025 * iterations)], 5),
        "ci_high": round(means[int(0.975 * iterations) - 1], 5),
        "iterations": iterations,
    }


def _hours_between(start: Optional[str], end: Optional[str]) -> Optional[float]:
    if not start or not end:
        return None
    try:
        a = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        b = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
    except ValueError:
        return None
    return round((b - a).total_seconds() / 3600.0, 2)


def _median(values: Sequence[float]) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _opt_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _publish(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, suffix=".tmp"
    )
    try:
        json.dump(payload, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, path)
    logger.info("wrote %s", path)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--devig", default="shin", choices=("shin", "proportional"))
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--log", default=str(LOG_PATH))
    args = parser.parse_args(argv)

    season = args.season or current_season()
    warehouse = get_warehouse()
    records = join(warehouse, season, args.devig, Path(args.log))

    report = evaluate(records, args.devig)
    report["season"] = season
    report["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # The per-game rows ride along: a record of eleven games that will not
    # show you the eleven games is an assertion, not evidence.
    report["games"] = [
        {
            k: v
            for k, v in record.items()
            if k in {
                "game_id", "tipoff_utc", "generated_at", "home_team", "away_team",
                "p_home", "home_won", "exp_margin", "margin", "exp_total",
                "total", "lead_hours", "clv",
            }
        }
        for record in sorted(records, key=lambda r: r["tipoff_utc"] or "")
    ]

    _publish(Path(args.out_dir) / "live_record.json", report)
    _print(report)
    return 0


def _print(report: Dict) -> None:
    print()
    print(f"LIVE RECORD — season {report['season']}, {report['n']} scored")
    if not report["n"]:
        print()
        print("  Nothing to score yet. This is the expected state until the")
        print("  first game with a stored pre-tipoff forecast is played.")
        print()
        return
    model = report["model"]
    print(f"  Brier {model['brier']:.4f}   accuracy {model['accuracy']:.1%}   "
          f"ECE {model['ece']:.4f}")
    paired = report.get("paired_vs_market") or {}
    if paired.get("n"):
        print(f"  vs market on {paired['n']}: model {paired['model']['brier']:.4f}, "
              f"market {paired['market']['brier']:.4f}, "
              f"gap {paired['gap_to_market']:+.5f}")
        print(f"  verdict: {paired['verdict']}")
    margin = report.get("margin") or {}
    if margin.get("n"):
        print(f"  margin MAE {margin['mae']:.2f} (bias {margin['bias']:+.2f})   "
              f"total MAE {report['total']['mae']:.2f} "
              f"(bias {report['total']['bias']:+.2f})")
    clv = (report.get("clv") or {}).get("flagged") or {}
    if clv.get("n"):
        print(f"  CLV on {clv['n']} flagged: mean {clv['mean_clv']:+.4f}, "
              f"beat close {clv['beat_close_rate']:.1%}, record {clv['record']}")
    print()


if __name__ == "__main__":
    sys.exit(main())
