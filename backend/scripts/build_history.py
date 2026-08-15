"""Export the historical archive the season and game pages render.

    python3 -m backend.scripts.build_history
    python3 -m backend.scripts.build_history --from-season 2015

Writes into `backend/data/history/`:

* `seasons.json`        — index of every season: champion, best record, counts
* `season_<year>.json`  — final standings, every game, playoff series
* `game_index.json`     — game_id → season, so a game URL needs no season
* `matchups.json`       — every ordered pair of franchises, forecast at
                          current ratings (the head-to-head surface)
* `game_context.json`   — series history, recent form and records, for the
                          fixture pages
* `allstar.json`        — All-Star weekend games, which live outside the
                          model entirely and are archive-only

**Every historical forecast in these files is a BACKTEST and is labelled
one.** The model that produced it was refit monthly on games strictly
earlier than the one it scores, so it never saw the game — but nobody saw
these numbers before those tip-offs either. The sibling soccer project is
emphatic on this point: a reconstructed forecast must never blur into
"published in advance", and `basis: "backtest"` rides on every record so
the UI cannot lose it.

The walk-forward here is the SAME code path as `benchmark_market`, not a
reimplementation of it. Two forecasters that are supposed to be the same
model and are written twice will drift, and the drift is invisible.

**`--from-season` limits which season FILES are rewritten, and nothing
else.** `seasons.json` and `game_index.json` are always rebuilt over the
whole corpus. This is not a detail: the daily job runs
`--from-season <current>` to avoid pushing 14MB of identical JSON through
git every morning, and an earlier version also filtered the index by it —
which cut the archive to a single season and left every one of the other
30,000 game URLs resolving to a 404, with 22 perfectly good season files
still sitting on disk. A guard below refuses to publish an index smaller
than the one already there.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)
from backend.services.forecast.version import model_version
from backend.services.playoffs.series import assign_depth, build_series
from backend.services.prediction import market as mkt
from backend.services.prediction.feature_builder import FEATURE_NAMES, FeatureBuilder
from backend.services.prediction.margin_model import MarginModel
from backend.services.ratings.elo import EloConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logger = logging.getLogger("build_history")

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "backend" / "data" / "history"

SCORED_TYPES = (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN)
REFIT_DAYS = 30
WARMUP_SEASONS = 3


def _publish(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # separators drop the space after ':' and ',' — over 31,844 games that is
    # about a fifth of the file size, and nothing reads these by hand.
    tmp.write_text(json.dumps(payload, separators=(",", ":")))
    tmp.replace(path)


def load_franchises(warehouse) -> Dict[int, Dict]:
    return {
        int(r["team_id"]): {
            "team_id": int(r["team_id"]),
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


def walk_forward(rows: Sequence, franchises: Dict[int, Dict]) -> List[Dict]:
    """Retrodict every game with a model that never saw it.

    Mirrors `benchmark_market.walk_forward`: metadata is emitted alongside
    each feature row so a record and its result cannot come apart, and the
    model refits on a rolling clock rather than once at a split.
    """
    builder = FeatureBuilder()
    X, margins, totals, meta = builder.build(rows)
    logger.info("built %d feature rows", len(X))

    dates = np.array([m["date_utc"] for m in meta])
    seasons = np.array([m["season"] for m in meta])
    start_season = int(seasons.min()) + WARMUP_SEASONS

    out: List[Dict] = []
    model = MarginModel()
    fitted = False
    next_refit: Optional[datetime] = None
    refits = 0

    for i in range(len(X)):
        record = dict(meta[i])
        record["basis"] = "backtest"

        if int(seasons[i]) >= start_season:
            when = datetime.fromisoformat(dates[i].replace("Z", "+00:00"))
            if next_refit is None or when >= next_refit:
                train = dates < dates[i]
                if int(train.sum()) >= 500:
                    model = MarginModel()
                    model.fit(
                        X[train], margins[train], totals[train], FEATURE_NAMES,
                        trained_through=dates[i],
                    )
                    fitted = True
                    next_refit = when + timedelta(days=REFIT_DAYS)
                    refits += 1
            if fitted:
                forecast = model.predict(X[i : i + 1])[0]
                record["p_home_model"] = round(forecast.p_home, 5)
                record["exp_margin"] = round(forecast.exp_margin, 2)
                record["exp_total"] = round(forecast.exp_total, 1)

        out.append(record)

    logger.info("retrodicted %d games across %d refits",
                sum(1 for r in out if "p_home_model" in r), refits)
    return out


def _market_probability(row) -> Optional[float]:
    if mkt.has_complete_odds(row["ml_home"], row["ml_away"]):
        try:
            return round(mkt.devig(float(row["ml_home"]), float(row["ml_away"]))[0], 5)
        except mkt.MarketError:
            return None
    if row["spread_home"] is not None:
        try:
            return round(mkt.spread_to_probability(float(row["spread_home"])), 5)
        except (TypeError, ValueError):
            return None
    return None


def _box(row, side: str) -> Optional[Dict]:
    """Box score for one side, or None when the source carried none.

    Absent is absent: a game with no box score renders a note saying so
    rather than a table of zeros, which would read as a team that attempted
    no shots.
    """
    keys = ("fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb",
            "reb", "ast", "stl", "blk", "tov", "pf")
    values = {}
    for key in keys:
        value = row[f"{side}_{key}"]
        if value is not None:
            values[key] = round(float(value), 1)
    return values or None


def _quarters(row, side: str) -> Optional[List[int]]:
    out = []
    for q in (1, 2, 3, 4):
        value = row[f"{side}_q{q}"]
        if value is None:
            return None
        out.append(int(value))
    return out


def build_season_file(
    season: int,
    rows: Sequence,
    retro: Dict[str, Dict],
    franchises: Dict[int, Dict],
) -> Dict:
    """Standings, games and playoff series for one season."""
    standings: Dict[int, Dict] = {
        tid: {
            **info,
            "wins": 0, "losses": 0,
            "points_for": 0, "points_against": 0,
            "home_wins": 0, "home_losses": 0,
            "away_wins": 0, "away_losses": 0,
        }
        for tid, info in franchises.items()
    }

    games: List[Dict] = []
    for row in rows:
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        if home not in franchises or away not in franchises:
            continue
        home_score, away_score = int(row["home_score"]), int(row["away_score"])
        home_won = home_score > away_score
        season_type = int(row["season_type"])
        phase = (row["phase"] or "")

        # The NBA Cup final is a regular-season-typed game that does NOT
        # count in the standings. Counting it puts one franchise on 83.
        counts_in_standings = (
            season_type == SEASON_TYPE_REGULAR
            and "cup championship" not in phase.lower()
        )
        if counts_in_standings:
            for tid, scored, allowed, won, venue in (
                (home, home_score, away_score, home_won, "home"),
                (away, away_score, home_score, not home_won, "away"),
            ):
                entry = standings[tid]
                entry["wins" if won else "losses"] += 1
                entry[f"{venue}_" + ("wins" if won else "losses")] += 1
                entry["points_for"] += scored
                entry["points_against"] += allowed

        record = retro.get(row["game_id"], {})
        game = {
            "id": row["game_id"],
            "date": row["date_utc"],
            "season": season,
            "type": season_type,
            "phase": phase or None,
            "home": franchises[home]["abbreviation"],
            "away": franchises[away]["abbreviation"],
            "home_id": home,
            "away_id": away,
            "home_score": home_score,
            "away_score": away_score,
            "ot": int(row["overtimes"] or 0),
            "venue": row["venue"],
            "neutral": bool(row["neutral_site"]),
        }
        # Carried so a playoff series page can gather its own games without
        # re-deriving the grouping the loader already did.
        if row["series_id"]:
            game["series_id"] = row["series_id"]
        quarters_home = _quarters(row, "home")
        quarters_away = _quarters(row, "away")
        if quarters_home and quarters_away:
            game["q_home"] = quarters_home
            game["q_away"] = quarters_away
        box_home, box_away = _box(row, "home"), _box(row, "away")
        if box_home:
            game["box_home"] = box_home
        if box_away:
            game["box_away"] = box_away

        market = _market_probability(row)
        if market is not None:
            game["p_market"] = market
        for field in ("ml_home", "ml_away", "spread_home", "total_points"):
            if row[field] is not None:
                game[field] = float(row[field])
        if "p_home_model" in record:
            game["p_model"] = record["p_home_model"]
            game["exp_margin"] = record["exp_margin"]
            game["exp_total"] = record["exp_total"]
            game["elo_home"] = round(record["elo_home"], 1)
            game["elo_away"] = round(record["elo_away"], 1)
            game["basis"] = "backtest"
        games.append(game)

    table = []
    for entry in standings.values():
        played = entry["wins"] + entry["losses"]
        if played == 0:
            continue  # a franchise that did not play this season
        entry["played"] = played
        entry["win_pct"] = round(entry["wins"] / played, 4)
        entry["point_diff"] = entry["points_for"] - entry["points_against"]
        entry["net_rating"] = round(entry["point_diff"] / played, 2)
        table.append(entry)
    table.sort(key=lambda e: (-e["win_pct"], -e["point_diff"]))

    for conference in ("Eastern Conference", "Western Conference"):
        members = [t for t in table if t["conference"] == conference]
        for rank, entry in enumerate(members, start=1):
            entry["conference_rank"] = rank

    series = build_series([r for r in rows if int(r["season_type"]) == SEASON_TYPE_POSTSEASON])
    assign_depth(series)
    champion = None
    for item in series:
        if item.depth == 0 and item.winner_id:
            champion = franchises.get(item.winner_id, {}).get("abbreviation")

    scored = [g for g in games if "p_model" in g]
    accuracy = None
    if scored:
        pairs = [(g["p_model"], g["home_score"] > g["away_score"]) for g in scored]
        accuracy = mkt.summarise(pairs)
        priced = [
            (g["p_market"], g["home_score"] > g["away_score"])
            for g in scored if "p_market" in g
        ]
        if priced:
            accuracy["market"] = mkt.summarise(priced)
            accuracy["paired_model"] = mkt.summarise([
                (g["p_model"], g["home_score"] > g["away_score"])
                for g in scored if "p_market" in g
            ])

    return {
        "season": season,
        "games": games,
        "standings": table,
        "champion": champion,
        "series": [
            {
                **s.as_dict(),
                "team_a": franchises.get(s.team_a_id, {}).get("abbreviation"),
                "team_b": franchises.get(s.team_b_id, {}).get("abbreviation"),
                "winner": franchises.get(s.winner_id, {}).get("abbreviation")
                if s.winner_id else None,
            }
            for s in series
        ],
        "accuracy": accuracy,
        "basis": "backtest",
    }


def build_matchups(
    warehouse, franchises: Dict[int, Dict]
) -> Dict:
    """Every ordered pair of franchises at current ratings.

    Precomputed rather than served from an endpoint: 870 ordered pairs is a
    90KB file, and a static answer cannot disagree with the game forecasts
    the way a second code path would. The soccer project's equivalent
    lesson — enumerate reachable pairings rather than caching lazily.
    """
    rows = [
        r
        for r in warehouse.iter_games(season_types=SCORED_TYPES)
        if int(r["home_team_id"]) in franchises and int(r["away_team_id"]) in franchises
    ]
    builder = FeatureBuilder()
    X, margins, totals, meta = builder.build(rows)
    model = MarginModel()
    model.fit(X, margins, totals, FEATURE_NAMES,
              trained_through=meta[-1]["date_utc"] if meta else None)

    from backend.services.espn.client import current_season

    season = current_season()
    if builder.elo.regress_to_season(season):
        logger.info("applied offseason regression for %s", season)

    when = datetime.now(timezone.utc)
    pairs = []
    ids = sorted(franchises)
    for home in ids:
        for away in ids:
            if home == away:
                continue
            vector = builder.vector_for(home, away, when)
            forecast = model.predict(vector.reshape(1, -1))[0]
            pairs.append({
                "home": franchises[home]["abbreviation"],
                "away": franchises[away]["abbreviation"],
                "p_home": round(forecast.p_home, 4),
                "exp_margin": round(forecast.exp_margin, 2),
                "exp_total": round(forecast.exp_total, 1),
                "exp_home_score": round(forecast.exp_home_score, 1),
                "exp_away_score": round(forecast.exp_away_score, 1),
            })

    return {
        "season": season,
        "generated_at": when.isoformat(timespec="seconds"),
        "teams": [franchises[t] for t in ids],
        "elo": {franchises[t]["abbreviation"]: round(builder.elo.get(t), 1) for t in ids},
        "matchups": pairs,
        "note": (
            "Neutral-court and rest-neutral: both sides are assumed rested, "
            "so this is the matchup in the abstract rather than a forecast "
            "for a specific date."
        ),
    }


H2H_DEPTH = 6
FORM_DEPTH = 10

# An All-Star event is identified by its PHASE, and here that is the right
# discriminator rather than the usual participation rule. The alternative
# signal — "one side is not an NBA franchise" — also catches every
# international exhibition in the corpus, and there are 120 of them: Real
# Madrid at Memphis, Maccabi at Cleveland, the Guangzhou Loong-Lions on tour.
# Those are preseason friendlies, not All-Star weekend. What makes a game the
# All-Star Game is that it IS the All-Star Game, so the name is the fact.
#
# The vocabulary is wildly inconsistent across 23 seasons and the pattern has
# to absorb all of it: "NBA All-Star Game", "NBA ALL-STAR GAME AT ORLANDO
# FL", "ALL STAR GAME", "NBA All-Star - Round Robin", "RISING STARS".
_ALLSTAR_RE = re.compile(r"all.?star|rising stars", re.I)


def build_context(rows: Sequence, franchises: Dict[int, Dict]) -> Dict:
    """The context a fixture page needs: the series history and recent form.

    **This exists so an UNPLAYED game has something to show.** Before tip-off
    there is no box score and no result, and a page carrying only a
    probability is a page that asserts a number and offers nothing to weigh
    it against. What a reader actually wants is the same thing a search
    result gives them: when these two last met and what happened, and how
    each side has been playing.

    Both are read straight off the corpus rather than recomputed per page.
    `rows` arrives in chronological order — `Warehouse.iter_games` sorts on
    `(date_utc, game_id)` — so the last N entries of each list ARE the most
    recent N, with no sort here to get subtly wrong.

    Head-to-head is keyed on the SORTED abbreviation pair, so a lookup does
    not have to know which side is at home. Six meetings is roughly two
    seasons of a divisional rivalry; ten games of form is a fortnight in a
    league that plays every other night.
    """
    meetings: Dict[str, List[Dict]] = defaultdict(list)
    form: Dict[str, List[Dict]] = defaultdict(list)
    records: Dict[str, Dict] = {}

    for row in rows:
        home_id, away_id = int(row["home_team_id"]), int(row["away_team_id"])
        home = franchises[home_id]["abbreviation"]
        away = franchises[away_id]["abbreviation"]
        home_score, away_score = int(row["home_score"]), int(row["away_score"])
        entry = {
            "id": row["game_id"],
            "date": row["date_utc"],
            "season": int(row["season"]),
            "type": int(row["season_type"]),
            "home": home,
            "away": away,
            "home_score": home_score,
            "away_score": away_score,
        }
        meetings["|".join(sorted((home, away)))].append(entry)

        for side, opponent, scored, allowed, at_home in (
            (home, away, home_score, away_score, True),
            (away, home, away_score, home_score, False),
        ):
            form[side].append(
                {
                    "id": row["game_id"],
                    "date": row["date_utc"],
                    "season": int(row["season"]),
                    "opponent": opponent,
                    "home": at_home,
                    "scored": scored,
                    "allowed": allowed,
                    "won": scored > allowed,
                }
            )

        # Regular-season record only. The postseason is a different
        # population and folding it in would flatter every team that made it.
        #
        # The NBA Cup Championship is excluded for the same reason it is
        # excluded from the standings: ESPN files it as a regular-season game
        # and the league does not count it, so including it puts one
        # franchise on 83 games. It did, on the first run — New York read
        # 54-29 here against 53-29 on the standings page.
        if (
            int(row["season_type"]) == SEASON_TYPE_REGULAR
            and "cup championship" not in str(row["phase"] or "").lower()
        ):
            for side, won in ((home, home_score > away_score), (away, away_score > home_score)):
                bucket = records.setdefault(side, {"season": 0, "wins": 0, "losses": 0})
                if int(row["season"]) != bucket["season"]:
                    bucket.update(season=int(row["season"]), wins=0, losses=0)
                bucket["wins" if won else "losses"] += 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "basis": "results",
        "h2h_depth": H2H_DEPTH,
        "form_depth": FORM_DEPTH,
        "head_to_head": {k: v[-H2H_DEPTH:] for k, v in meetings.items()},
        "form": {k: v[-FORM_DEPTH:] for k, v in form.items()},
        "records": records,
    }


def build_allstar(warehouse) -> Dict:
    """Every All-Star weekend game the source publishes, by season.

    **Not a model surface.** Nothing here is forecast, benchmarked or fed to
    anything: the sides are drafted teams that exist for one night, half the
    games are untimed races to a target score, and a franchise rating means
    nothing in them. This is an archive, and the artifact says so.

    Kept OUT of the ratings and the standings for the same reason, which is
    why these games are invisible everywhere else on the site — the sides
    carry no conference, so every franchise filter drops them. That was the
    right call and it is also why they needed publishing separately.

    **What is missing is stated rather than hidden.** ESPN's scoreboard
    publishes All-Star weekend GAMES. The Saturday-night events — the
    three-point contest, the dunk contest, the skills challenge — are not
    games and are not in the feed at all, so they are absent here. An
    archive that quietly omitted them would imply this is the whole weekend.
    """
    teams = {
        int(r["team_id"]): dict(r)
        for r in warehouse.conn.execute("SELECT * FROM teams")
    }
    by_season: Dict[int, List[Dict]] = defaultdict(list)
    for row in warehouse.iter_games():
        phase = row["phase"] or ""
        if not _ALLSTAR_RE.search(phase):
            continue
        home, away = int(row["home_team_id"]), int(row["away_team_id"])
        event = {
            "id": row["game_id"],
            "date": row["date_utc"],
            "season": int(row["season"]),
            "phase": phase,
            "label": _allstar_label(phase),
            "venue": row["venue"],
            "home": _allstar_side(teams.get(home), home),
            "away": _allstar_side(teams.get(away), away),
            "home_score": int(row["home_score"]),
            "away_score": int(row["away_score"]),
        }
        quarters_home, quarters_away = _quarters(row, "home"), _quarters(row, "away")
        if quarters_home and quarters_away:
            event["q_home"] = quarters_home
            event["q_away"] = quarters_away
        by_season[int(row["season"])].append(event)

    seasons = [
        {
            "season": season,
            "label": f"{season - 1}-{str(season)[2:]}",
            "events": sorted(events, key=lambda e: e["date"]),
        }
        for season, events in sorted(by_season.items(), reverse=True)
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "basis": "results",
        "seasons": seasons,
        "n_events": sum(len(s["events"]) for s in seasons),
        "note": (
            "All-Star weekend games as the source publishes them. The "
            "three-point contest, the dunk contest and the skills challenge "
            "are not games and are not in the feed, so they are not here. "
            "Nothing on this page is forecast or scored: the sides are "
            "one-night drafts and several of these games are untimed races "
            "to a target score, so a rating model has nothing to say."
        ),
    }


def _allstar_side(team: Optional[Dict], team_id: int) -> Dict:
    """One All-Star side, with ESPN's truncated names repaired.

    The feed stores "Eastern Confe All-Stars" — a 20-character column
    somewhere upstream. Repaired on the way out rather than in the teams
    table, because the table holds what the source said and this is a
    display concern.
    """
    name = (team or {}).get("display_name") or f"Team {team_id}"
    name = re.sub(r"\bConfe\b", "Conference", name)
    # "Team Stars Team Stars" — the feed doubles some side names.
    words = name.split()
    half = len(words) // 2
    if half and words[:half] == words[half:]:
        name = " ".join(words[:half])
    return {
        "team_id": team_id,
        "name": name,
        "abbreviation": (team or {}).get("abbreviation"),
        "logo": (team or {}).get("logo"),
    }


def _allstar_label(phase: str) -> str:
    """A readable event name from ESPN's inconsistent phase string.

    Twenty-three seasons of "NBA ALL-STAR GAME AT ORLANDO FL", "NBA All-Star
    - Round Robin" and "First team to 40 points wins - Untimed" reduce to
    something a reader can scan. The raw phase is kept alongside it, because
    the tidied version is a convenience and the source string is the record.
    """
    text = re.sub(r"\s+", " ", phase).strip()
    if re.search(r"rising stars", text, re.I):
        return "Rising Stars"
    # Drop the venue tail: "... AT ORLANDO FL", "... at Los Angeles CA".
    text = re.sub(r"\s+AT\s+[A-Z][A-Za-z .]*$", "", text, flags=re.I)
    # Drop the format footnote: "First team to 40 points wins - Untimed".
    text = re.sub(r"\s*First team to.*$", "", text, flags=re.I)
    text = text.strip(" -")
    if re.fullmatch(r"(nba\s+)?all.?star(\s+game)?", text, re.I):
        return "All-Star Game"
    if re.match(r"(nba\s+)?all.?star\s*-\s*", text, re.I):
        return re.sub(r"^(nba\s+)?all.?star\s*-\s*", "All-Star ", text, flags=re.I)
    return text or "All-Star"


def build_rating_history(rows: Sequence, franchises: Dict[int, Dict]) -> Dict:
    """End-of-season Elo per franchise, for the ratings chart."""
    from backend.services.ratings.elo import EloRatingSystem

    elo = EloRatingSystem(EloConfig())
    per_season: Dict[int, Dict[int, float]] = defaultdict(dict)
    for rated in elo.run(rows):
        per_season[rated.season][rated.home_team_id] = rated.home_elo_post
        per_season[rated.season][rated.away_team_id] = rated.away_elo_post

    seasons = sorted(per_season)
    return {
        "seasons": seasons,
        "teams": {
            info["abbreviation"]: [
                round(per_season[s].get(tid), 1) if per_season[s].get(tid) else None
                for s in seasons
            ]
            for tid, info in franchises.items()
        },
    }


def seasons_lost(path: Path, publishing: set) -> List[int]:
    """Seasons the live index carries that this run would drop.

    The same guard `forecast_season` applies to franchises, for the same
    reason: comparing against what is actually on disk rather than against a
    constant, so a season genuinely leaving the corpus is a decision someone
    makes rather than something a flag does silently.
    """
    if not path.exists():
        return []
    try:
        previous = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    served = {int(s["season"]) for s in previous.get("seasons", [])}
    return sorted(served - publishing)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-season", type=int, default=None,
                        help="earliest season whose FILE is rewritten "
                             "(the index always covers every season)")
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--skip-matchups", action="store_true")
    parser.add_argument("--allow-missing-seasons", action="store_true",
                        help="publish an index smaller than the live one")
    args = parser.parse_args(argv)

    warehouse = get_warehouse()
    franchises = load_franchises(warehouse)
    logger.info("%d franchises", len(franchises))

    rows = [
        r
        for r in warehouse.iter_games(season_types=SCORED_TYPES)
        if int(r["home_team_id"]) in franchises and int(r["away_team_id"]) in franchises
    ]
    logger.info("corpus: %d games", len(rows))
    if not rows:
        logger.error("empty corpus — run build_warehouse")
        return 1

    retro_list = walk_forward(rows, franchises)
    retro = {r["game_id"]: r for r in retro_list}

    out_dir = Path(args.out_dir)
    by_season: Dict[int, List] = defaultdict(list)
    for row in rows:
        by_season[int(row["season"])].append(row)

    # EVERY season is built. `--from-season` decides only which files get
    # rewritten — the index and the game→season map are always complete, or
    # the archive loses the seasons whose files were left alone.
    seasons = sorted(by_season)
    rewrite = (
        {s for s in seasons if s >= args.from_season}
        if args.from_season
        else set(seasons)
    )
    if args.from_season:
        logger.info(
            "rewriting %d of %d season files (--from-season %s); the index "
            "still covers all of them",
            len(rewrite), len(seasons), args.from_season,
        )

    index = []
    game_index: Dict[str, int] = {}
    for season in seasons:
        payload = build_season_file(season, by_season[season], retro, franchises)
        if season in rewrite:
            _publish(out_dir / f"season_{season}.json", payload)

        for game in payload["games"]:
            game_index[game["id"]] = season

        leader = payload["standings"][0] if payload["standings"] else None
        index.append({
            "season": season,
            "label": f"{season - 1}-{str(season)[2:]}",
            "games": len(payload["games"]),
            "champion": payload["champion"],
            "best_record": (
                {
                    "team": leader["abbreviation"],
                    "name": leader["name"],
                    "wins": leader["wins"],
                    "losses": leader["losses"],
                }
                if leader else None
            ),
            "scored": (payload["accuracy"] or {}).get("n", 0),
            "model_brier": (payload["accuracy"] or {}).get("brier"),
            "market_brier": ((payload["accuracy"] or {}).get("market") or {}).get("brier"),
        })
        logger.info("season %s: %d games, champion %s",
                    season, len(payload["games"]), payload["champion"])

    lost = seasons_lost(out_dir / "seasons.json", {s["season"] for s in index})
    if lost and not args.allow_missing_seasons:
        logger.error(
            "refusing to publish: the live index carries %d season(s) this "
            "run would drop (%s). The archive on disk is left as it is. This "
            "is the guard for the --from-season bug: a filtered index turns "
            "30,000 game URLs into 404s while their season files sit there "
            "intact. Pass --allow-missing-seasons only when a season is "
            "genuinely leaving the corpus.",
            len(lost), ", ".join(str(s) for s in lost[:5]),
        )
        return 1

    _publish(out_dir / "seasons.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "basis": "backtest",
        "warmup_seasons": WARMUP_SEASONS,
        "seasons": sorted(index, key=lambda s: -s["season"]),
    })
    _publish(out_dir / "game_index.json", game_index)
    _publish(out_dir / "rating_history.json",
             build_rating_history(rows, franchises))
    # Always over the WHOLE corpus, never `--from-season`: the series history
    # a fixture page shows is the last six meetings wherever they fall, and
    # rebuilding it from the current season alone would silently empty it
    # every morning the daily job runs.
    _publish(out_dir / "game_context.json", build_context(rows, franchises))
    _publish(out_dir / "allstar.json", build_allstar(warehouse))

    if not args.skip_matchups:
        _publish(out_dir / "matchups.json", build_matchups(warehouse, franchises))

    total = sum(f.stat().st_size for f in out_dir.glob("*.json"))
    logger.info("wrote %d files, %.1f MB", len(list(out_dir.glob("*.json"))),
                total / 1e6)
    return 0


if __name__ == "__main__":
    sys.exit(main())
