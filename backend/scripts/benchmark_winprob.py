"""Score the in-game win probability model against ESPN's own curve.

    python3 -m backend.scripts.benchmark_winprob
    python3 -m backend.scripts.benchmark_winprob --train 2025 --test 2026

Writes `backend/data/diagnostics/winprob_benchmark.json`.

**The baseline here is not the betting market, and that is what makes this
worth doing.** Everywhere else on this site the yardstick is the closing
line, a forecaster with more information than ours by construction, and the
honest expected result is that we lose. ESPN's in-game curve reads the same
three things this model reads — the clock, the score, and nothing else that
matters — so for once the comparison is between two forecasters on equal
footing, and beating it would be a real result rather than a bug.

Two baselines are kept alongside it, per the standing rule that a baseline is
never deleted:

* **the home base rate**, said at every moment regardless of the score, which
  is the "does this do anything at all" floor;
* **the pre-game model's own number**, held flat for the whole game, which
  asks the sharper question: does watching the game beat not watching it?
  A live model that cannot beat a static pre-game probability is not adding
  information, it is adding noise.

The split is by SEASON, not by state. Splitting states at random would put
the third quarter of a game in training and its fourth quarter in test —
the same game, the same result, leaking directly. Whole seasons held out is
the only split that keeps a game intact.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx
import numpy as np

from backend.services.data.warehouse import get_warehouse
from backend.services.prediction import market as mkt
from backend.services.prediction.live_winprob import (
    LiveWinProbModel,
    tied_game_baseline,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("benchmark_winprob")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "backend" / "data" / "diagnostics" / "winprob_benchmark.json"


def load_states(warehouse, seasons: Sequence[int]) -> Dict[str, np.ndarray]:
    placeholders = ",".join("?" for _ in seasons)
    rows = list(
        warehouse.conn.execute(
            f"SELECT game_id, seconds_remaining, score_diff, home_won, season "
            f"FROM game_states WHERE season IN ({placeholders})",
            list(seasons),
        )
    )
    if not rows:
        return {}
    return {
        "game_id": np.array([str(r["game_id"]) for r in rows]),
        "seconds": np.array([float(r["seconds_remaining"]) for r in rows]),
        "lead": np.array([float(r["score_diff"]) for r in rows]),
        "won": np.array([float(r["home_won"]) for r in rows]),
        "season": np.array([int(r["season"]) for r in rows]),
    }


ARCHIVE = ROOT / "backend" / "data" / "history"


def pregame_probabilities(seasons: Sequence[int]) -> Dict[str, float]:
    """The pre-game model's own number for each game, from the archive.

    Held flat across the whole game, this is the baseline that asks the
    sharpest question available: **does watching the game beat not watching
    it?** A live model that cannot beat a static pre-game probability is not
    adding information to the pre-game one, it is adding noise to it — and
    that is a failure the home-base-rate floor is far too weak to catch.
    """
    out: Dict[str, float] = {}
    for season in seasons:
        path = ARCHIVE / f"season_{season}.json"
        try:
            payload = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            logger.warning("no archive for season %s; skipping its pre-game baseline", season)
            continue
        for game in payload.get("games") or []:
            value = game.get("p_model")
            if value is not None:
                out[str(game["id"])] = float(value)
    return out


def summarise(p: np.ndarray, y: np.ndarray) -> Dict[str, float]:
    pairs = list(zip(p.tolist(), (y > 0.5).tolist()))
    return mkt.summarise(pairs)


def by_time_bucket(
    p: np.ndarray, y: np.ndarray, seconds: np.ndarray
) -> List[Dict]:
    """Brier by quarter, because a mean over all states hides where it fails.

    Almost every state in a game is in the middle, where every forecaster
    agrees and the score is easy. The last two minutes are where a live model
    earns anything, and they are a rounding error in the pooled number.
    """
    buckets = [
        ("Q1", 2160, 2880), ("Q2", 1440, 2160), ("Q3", 720, 1440),
        ("Q4", 120, 720), ("last 2 min", 0, 120), ("overtime", -3000, 0),
    ]
    out = []
    for label, lo, hi in buckets:
        mask = (seconds > lo) & (seconds <= hi)
        if mask.sum() < 50:
            continue
        scored = summarise(p[mask], y[mask])
        out.append({
            "bucket": label,
            "n": int(mask.sum()),
            "brier": scored["brier"],
            "accuracy": scored["accuracy"],
            "ece": scored["ece"],
        })
    return out


SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary"


def espn_curve(client: httpx.Client, game_id: str) -> List[Tuple[int, float]]:
    """ESPN's own win probability, as `(play index, home probability)`.

    Fetched here rather than stored in the warehouse because it is somebody
    else's forecast: it is a BASELINE, not model input, and the rule that
    keeps player lines out of the warehouse keeps this out too.
    """
    try:
        response = client.get(SUMMARY, params={"event": game_id}, timeout=20.0)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []
    out: List[Tuple[int, float]] = []
    for i, entry in enumerate(payload.get("winprobability") or []):
        value = (entry or {}).get("homeWinPercentage")
        if value is None:
            continue
        try:
            p = float(value)
        except (TypeError, ValueError):
            continue
        if 0.0 <= p <= 1.0:
            out.append((i, p))
    return out


def compare_to_espn(
    warehouse,
    model,
    game_ids: Sequence[str],
    *,
    delay: float,
) -> Optional[Dict]:
    """Score both forecasters on the SAME states of the same games.

    **The matching is the whole difficulty and the reason this is a sample
    rather than the full season.** ESPN publishes one probability per play;
    the ingest stores one row per distinct (clock, score) state, having
    deduplicated the rebound that shares a timestamp with the shot before it.
    The two sequences therefore do not line up one-to-one, and pairing them by
    index would compare our 200th state to ESPN's 240th play — a comparison
    that would look fine and mean nothing.

    They are matched on the FRACTION through each sequence instead, which is
    monotone in both and robust to the differing lengths. It is approximate,
    it is stated as approximate, and it is far better than an index join.
    """
    paired_model: List[Tuple[float, bool]] = []
    paired_espn: List[Tuple[float, bool]] = []
    matched_games = 0

    with httpx.Client(headers={"Accept": "application/json"}) as client:
        for game_id in game_ids:
            rows = list(warehouse.conn.execute(
                "SELECT seconds_remaining, score_diff, home_won FROM game_states "
                "WHERE game_id = ? ORDER BY -seconds_remaining",
                (game_id,),
            ))
            curve = espn_curve(client, game_id)
            time.sleep(delay)
            if len(rows) < 20 or len(curve) < 20:
                continue

            matched_games += 1
            won = bool(rows[0]["home_won"])
            seconds = np.array([float(r["seconds_remaining"]) for r in rows])
            lead = np.array([float(r["score_diff"]) for r in rows])
            ours = model.predict(seconds, lead)

            for i, p_ours in enumerate(ours):
                # Same position through the game, not the same index.
                j = min(
                    int(round(i / max(len(ours) - 1, 1) * (len(curve) - 1))),
                    len(curve) - 1,
                )
                paired_model.append((float(p_ours), won))
                paired_espn.append((curve[j][1], won))

    if not paired_model:
        return None
    ours_scored = mkt.summarise(paired_model)
    espn_scored = mkt.summarise(paired_espn)
    return {
        "n_games": matched_games,
        "n_states": len(paired_model),
        "matching": "by fraction through each sequence, not by play index",
        "live_model": ours_scored,
        "espn": espn_scored,
        "gap_to_espn": round(ours_scored["brier"] - espn_scored["brier"], 5),
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", default="2025", help="comma-separated seasons")
    parser.add_argument("--test", default="2026")
    parser.add_argument("--espn-sample", type=int, default=0,
                        help="test games to also score ESPN's own curve on")
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--output", default=str(OUT_PATH))
    args = parser.parse_args(argv)

    train_seasons = [int(s) for s in args.train.split(",") if s.strip()]
    test_seasons = [int(s) for s in args.test.split(",") if s.strip()]
    overlap = set(train_seasons) & set(test_seasons)
    if overlap:
        raise SystemExit(f"seasons {sorted(overlap)} are in both train and test")

    warehouse = get_warehouse()
    train = load_states(warehouse, train_seasons)
    test = load_states(warehouse, test_seasons)
    if not train:
        logger.error("no ingested states for seasons %s — run build_winprob", train_seasons)
        return 1
    if not test:
        logger.error("no ingested states for seasons %s — run build_winprob", test_seasons)
        return 1

    model = LiveWinProbModel().fit(
        train["seconds"], train["lead"], train["won"], seasons=train_seasons
    )
    logger.info(
        "fitted on %d regulation and %d overtime states from %s",
        model.n_regulation, model.n_overtime, train_seasons,
    )

    p_model = model.predict(test["seconds"], test["lead"])
    y = test["won"]

    # The home base rate, taken from TRAINING so it is not read off the test
    # set — a baseline that peeks is not a baseline.
    base = tied_game_baseline(train["won"] > 0.5)
    p_base = np.full_like(y, base)

    # The pre-game forecast, held flat. Only the states whose game carries one
    # are scored, and all three forecasters are scored on THAT subset so the
    # comparison is paired — scoring the live model on every state and the
    # pre-game baseline on a subset would compare two different corpora.
    pregame = pregame_probabilities(test_seasons)
    has_pregame = np.array([gid in pregame for gid in test["game_id"]])
    p_pregame = np.array([pregame.get(gid, base) for gid in test["game_id"]])

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "train_seasons": train_seasons,
        "test_seasons": test_seasons,
        "n_train_states": int(len(train["won"])),
        "n_test_states": int(len(y)),
        "n_test_games": int(len(set(test["game_id"].tolist()))),
        "coefficients": model.as_dict(),
        "note": (
            "Split by whole SEASON. Splitting states at random would put the "
            "third quarter of a game in training and its fourth in test — "
            "same game, same result, a direct leak."
        ),
        "ladder": {
            "live_model": summarise(p_model, y),
            "home_base_rate": summarise(p_base, y),
        },
        "vs_pregame": {
            "n_states": int(has_pregame.sum()),
            "n_games": int(len(set(test["game_id"][has_pregame].tolist()))),
            "note": (
                "The pre-game forecast held flat for the whole game, against "
                "the live model on exactly the same states. This is the "
                "baseline that asks whether watching the game beats not "
                "watching it."
            ),
            "live_model": summarise(p_model[has_pregame], y[has_pregame]),
            "pregame_held_flat": summarise(p_pregame[has_pregame], y[has_pregame]),
        } if has_pregame.any() else None,
        "by_time": {
            "live_model": by_time_bucket(p_model, y, test["seconds"]),
            "home_base_rate": by_time_bucket(p_base, y, test["seconds"]),
        },
    }

    if args.espn_sample:
        ids = sorted(set(test["game_id"].tolist()))[: args.espn_sample]
        logger.info("scoring ESPN's own curve on %d test games", len(ids))
        report["vs_espn"] = compare_to_espn(
            warehouse, model, ids, delay=args.delay
        )

    _print(report)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2))
    logger.info("wrote %s", output)
    return 0


def _print(report: Dict) -> None:
    print()
    print(f"LIVE WIN PROBABILITY  train {report['train_seasons']} -> "
          f"test {report['test_seasons']}")
    print(f"  {report['n_test_games']} test games, "
          f"{report['n_test_states']:,} states")
    print()
    print(f"{'forecaster':<20}{'Brier':>10}{'acc':>9}{'ECE':>9}")
    for label, key in (("Live model", "live_model"),
                       ("Home base rate", "home_base_rate")):
        s = report["ladder"][key]
        print(f"{label:<20}{s['brier']:>10.4f}{s['accuracy']:>9.4f}{s['ece']:>9.4f}")
    print()
    print(f"{'bucket':<14}{'n':>9}{'Brier':>10}{'acc':>9}")
    for row in report["by_time"]["live_model"]:
        print(f"{row['bucket']:<14}{row['n']:>9,}{row['brier']:>10.4f}"
              f"{row['accuracy']:>9.4f}")
    print()
    pre = report.get("vs_pregame")
    if pre:
        print(f"VS THE PRE-GAME FORECAST  {pre['n_games']} games, "
              f"{pre['n_states']:,} states")
        print(f"{'forecaster':<20}{'Brier':>10}{'acc':>9}{'ECE':>9}")
        for label, key in (("Live model", "live_model"),
                           ("Pre-game, flat", "pregame_held_flat")):
            s = pre[key]
            print(f"{label:<20}{s['brier']:>10.4f}{s['accuracy']:>9.4f}"
                  f"{s['ece']:>9.4f}")
        print()

    versus = report.get("vs_espn")
    if versus:
        print(f"VS ESPN  {versus['n_games']} games, {versus['n_states']:,} states")
        print(f"{'forecaster':<20}{'Brier':>10}{'acc':>9}{'ECE':>9}")
        print(f"{'This model':<20}{versus['live_model']['brier']:>10.4f}"
              f"{versus['live_model']['accuracy']:>9.4f}"
              f"{versus['live_model']['ece']:>9.4f}")
        print(f"{'ESPN':<20}{versus['espn']['brier']:>10.4f}"
              f"{versus['espn']['accuracy']:>9.4f}{versus['espn']['ece']:>9.4f}")
        print(f"  gap (ours - ESPN): {versus['gap_to_espn']:+.5f}")
        print()

    coefficients = report["coefficients"]["regulation"] or {}
    if coefficients:
        print("  regulation fit: " + ", ".join(
            f"{k} {v:+.4f}" for k, v in coefficients.items()))
    print()


if __name__ == "__main__":
    sys.exit(main())
