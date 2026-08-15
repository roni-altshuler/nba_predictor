"""ESPN → warehouse loader.

Translates raw ESPN scoreboard events into canonical `GameRow` /
`ScheduledGameRow` objects and writes them to the warehouse.

Landmines this module exists to hold, each one measured against the live API:

* **`dates=` filters on US EASTERN local date, not UTC.** The 2026 Finals
  Game 1 is stamped `2026-06-04T00:30Z` and `dates=20260604` returns nothing
  for it — it was played on the evening of 3 June in New York. Every range
  fetch therefore overlaps its chunks and de-duplicates on event id, and no
  caller may assume a UTC date maps to an ESPN date.

* **A game with `state != "post"` is not a result.** `games` is results-only.
  An in-progress game carries a score that is not final, and writing it
  makes every downstream consumer — Elo, the margin model, the evaluator —
  read a partial score as a fact. In-progress and scheduled games go to
  `scheduled_games`, which is also what makes the "already played" filter in
  the season simulation correct.

* **Postponed games look final enough to fool a status check.** ESPN files
  them `state == "post"` with `STATUS_POSTPONED` and 0-0. The guard is on
  `type.name`, not on `state`, plus a refusal to write a 0-0 basketball game
  — a real one has never happened.

* **Season type must come from the EVENT, never inferred from the date.**
  Preseason, regular season, play-in, All-Star and playoffs overlap the
  calendar in both directions: the 2020 bubble ran the regular season into
  August, and play-in games sit between the two. Filtering an All-Star Game
  out by date would take real games with it.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import (
    SEASON_TYPE_ALLSTAR,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_PRESEASON,
    SEASON_TYPE_REGULAR,
    GameRow,
    ScheduledGameRow,
    Warehouse,
)

logger = logging.getLogger(__name__)

NBA_COMPETITION_ID = "nba"

COMPETITIONS: Tuple[Dict[str, Any], ...] = (
    {"competition_id": "nba", "name": "NBA", "level": "major"},
)

# ESPN box-score stat names → warehouse column suffixes. Split pairs like
# "fieldGoalsMade-fieldGoalsAttempted" expand into two columns.
_SPLIT_STATS = {
    "fieldGoalsMade-fieldGoalsAttempted": ("fgm", "fga"),
    "threePointFieldGoalsMade-threePointFieldGoalsAttempted": ("fg3m", "fg3a"),
    "freeThrowsMade-freeThrowsAttempted": ("ftm", "fta"),
}
_SCALAR_STATS = {
    "totalRebounds": "reb",
    "offensiveRebounds": "oreb",
    "defensiveRebounds": "dreb",
    "assists": "ast",
    "steals": "stl",
    "blocks": "blk",
    "turnovers": "tov",
    "totalTurnovers": "tov",
    "fouls": "pf",
}

# ESPN sometimes files the play-in round under the postseason type with a
# note naming it. Recognised so the play-in never trains the playoff-series
# model — a play-in game is a one-off, not a best-of-seven.
_PLAY_IN_RE = re.compile(r"play[-\s]?in", re.IGNORECASE)

# Bracket SLOTS that ESPN publishes for rounds that have not been drawn yet.
# The 2026-27 schedule carries six such fixtures — the NBA Cup quarter-finals,
# semi-finals and final — with both sides named "TBD".
#
# **These are refused at the INGESTER, not at the simulator.** A junk row in
# `teams` is permanent, competes with every later name lookup, and puts
# phantom games into the season projection. The sibling soccer project learned
# this from ESPN's undrawn Asian Cup rounds, where placeholder competitors
# like "Group A 2nd Place" were resolved into one invented club and produced a
# tie whose two sides were the same team — a guaranteed advance.
_PLACEHOLDER_NAMES = {
    "tbd", "tba", "to be determined", "to be announced", "bye",
    "winner", "loser", "team tbd",
}
_PLACEHOLDER_RE = re.compile(
    r"^(tbd|tba|bye)$|winner of|loser of|\d(st|nd|rd|th)\s+place|"
    r"group\s+[a-h]\s|seed\s+\d",
    re.IGNORECASE,
)


def is_placeholder(name: Optional[str]) -> bool:
    """True when a competitor is a bracket slot rather than a franchise."""
    if not name:
        return True
    text = str(name).strip()
    if text.lower() in _PLACEHOLDER_NAMES:
        return True
    return bool(_PLACEHOLDER_RE.search(text))


class ESPNLoader:
    """Parses ESPN events and writes them to the warehouse."""

    def __init__(self, warehouse: Warehouse):
        self.wh = warehouse
        self._team_cache: Dict[str, int] = {}
        for competition in COMPETITIONS:
            self.wh.upsert_competition(
                competition["competition_id"], competition["name"], competition["level"]
            )

    # ------------------------------------------------------------- teams

    def register_teams(self, teams: Iterable[Dict[str, Any]]) -> int:
        """Seed `teams` from ESPN's team directory."""
        count = 0
        for team in teams:
            espn_id = str(team.get("id") or "")
            if not espn_id:
                continue
            logos = team.get("logos") or []
            team_id = self.wh.upsert_team(
                espn_id,
                team.get("displayName") or team.get("name") or espn_id,
                short_name=team.get("shortDisplayName") or team.get("name"),
                abbreviation=team.get("abbreviation"),
                logo=(logos[0].get("href") if logos else team.get("logo")),
            )
            self._team_cache[espn_id] = team_id
            for alias in filter(None, (
                team.get("displayName"),
                team.get("name"),
                team.get("shortDisplayName"),
                team.get("nickname"),
                team.get("location"),
            )):
                if alias and alias != team.get("location"):
                    self.wh.add_alias(alias, team_id)
            count += 1
        return count

    def apply_standings(self, payload: Dict[str, Any]) -> int:
        """Attach conference/division membership from a standings payload.

        Conference membership is READ from ESPN rather than hard-coded,
        because a hard-coded map stops being true the season a team moves and
        nothing would say so. The same reasoning the soccer project applies to
        the MLS playoff cut line.
        """
        updated = 0
        for conference in payload.get("children") or []:
            conf_name = conference.get("name") or conference.get("shortName")
            entries = (conference.get("standings") or {}).get("entries") or []
            for entry in entries:
                team = entry.get("team") or {}
                espn_id = str(team.get("id") or "")
                if not espn_id:
                    continue
                team_id = self.wh.upsert_team(
                    espn_id,
                    team.get("displayName") or espn_id,
                    abbreviation=team.get("abbreviation"),
                    conference=conf_name,
                    logo=team.get("logo"),
                )
                self._team_cache[espn_id] = team_id
                updated += 1
        return updated

    def _team_key(self, competitor: Dict[str, Any], seen: Optional[str]) -> Optional[int]:
        team = competitor.get("team") or {}
        espn_id = str(team.get("id") or "")
        if not espn_id:
            return None
        # Refuse a bracket slot before it can become a permanent `teams` row.
        for candidate in (team.get("displayName"), team.get("name"),
                          team.get("abbreviation")):
            if candidate and is_placeholder(candidate):
                return None
        cached = self._team_cache.get(espn_id)
        if cached is not None:
            return cached
        logos = team.get("logos") or []
        team_id = self.wh.upsert_team(
            espn_id,
            team.get("displayName") or team.get("name") or espn_id,
            short_name=team.get("shortDisplayName"),
            abbreviation=team.get("abbreviation"),
            logo=(logos[0].get("href") if logos else team.get("logo")),
            seen=seen,
        )
        self._team_cache[espn_id] = team_id
        return team_id

    # ------------------------------------------------------------- parse

    def parse_event(
        self, event: Dict[str, Any]
    ) -> Tuple[Optional[GameRow], Optional[ScheduledGameRow]]:
        """Turn one ESPN event into either a result row or a scheduled row.

        Returns `(game, None)`, `(None, scheduled)`, or `(None, None)` when
        the event is not a game this project stores.
        """
        event_id = str(event.get("id") or "")
        if not event_id:
            return None, None

        competitions = event.get("competitions") or []
        if not competitions:
            return None, None
        comp = competitions[0]

        season_block = event.get("season") or {}
        season = _as_int(season_block.get("year"))
        season_type = _as_int(season_block.get("type"))
        if season is None or season_type is None:
            return None, None

        date_utc = _normalise_date(event.get("date") or comp.get("date"))
        if not date_utc:
            return None, None

        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if home is None or away is None:
            return None, None

        home_id = self._team_key(home, date_utc)
        away_id = self._team_key(away, date_utc)
        if home_id is None or away_id is None:
            return None, None
        if home_id == away_id:
            # A fixture whose two sides resolve to the same franchise is
            # refused whatever it is called — it is a guaranteed-outcome row
            # that would poison every rating it touches.
            logger.warning("Refusing event %s: both sides resolve to team %s",
                           event_id, home_id)
            return None, None

        notes = " ".join(
            str(n.get("headline") or "") for n in (comp.get("notes") or [])
        )
        if season_type == SEASON_TYPE_POSTSEASON and _PLAY_IN_RE.search(notes):
            season_type = SEASON_TYPE_PLAY_IN

        status = (event.get("status") or comp.get("status") or {})
        status_type = status.get("type") or {}
        state = status_type.get("state")
        status_name = str(status_type.get("name") or "")
        completed = bool(status_type.get("completed"))

        venue = (comp.get("venue") or {}).get("fullName")
        neutral = 1 if comp.get("neutralSite") else 0
        series = comp.get("series") or {}
        series_id = _series_id(event, comp, season, season_type)

        shared: Dict[str, Any] = {
            "neutral_site": neutral,
            "venue": venue,
            "phase": notes or (status_type.get("description") if not notes else None),
            "series_id": series_id,
        }

        odds = _extract_odds(comp, home, away)
        shared.update(odds)

        abandoned = any(
            token in status_name
            for token in ("POSTPONED", "CANCELED", "CANCELLED", "SUSPENDED", "FORFEIT")
        )
        is_final = state == "post" and completed and not abandoned

        if abandoned:
            # **A postponed game is neither a result nor a fixture.** ESPN
            # keeps the original event forever with STATUS_POSTPONED, and
            # publishes the makeup under a NEW event id. Filing the original
            # as "scheduled" leaves a game in the remaining set that will
            # never be played: the 2025-26 season ended with four such rows,
            # each one adding a phantom game to every season simulation and
            # an entry to the upcoming-games list that no date could clear.
            #
            # It is not a result either — there is no score — so it is
            # dropped, and the makeup arrives on its own id.
            logger.debug("dropping abandoned event %s (%s)", event_id, status_name)
            return None, None

        if not is_final:
            return None, ScheduledGameRow(
                game_id=event_id,
                source="espn",
                competition_id=NBA_COMPETITION_ID,
                season=season,
                season_type=season_type,
                date_utc=date_utc,
                home_team_id=home_id,
                away_team_id=away_id,
                extra={k: v for k, v in shared.items()
                       if k in {"neutral_site", "venue", "phase", "series_id",
                                "ml_home", "ml_away", "spread_home",
                                "total_points", "odds_provider"}},
            )

        home_score = _as_int(home.get("score"))
        away_score = _as_int(away.get("score"))
        if home_score is None or away_score is None:
            return None, None
        if home_score == 0 and away_score == 0:
            # No NBA game has ever finished 0-0. A "final" that reads 0-0 is
            # a postponement ESPN has not labelled, and writing it would
            # hand every model a fictional blowout-free game.
            logger.debug("Refusing 0-0 final for event %s", event_id)
            return None, None

        extra = dict(shared)
        extra.update(_linescores(home, "home"))
        extra.update(_linescores(away, "away"))
        extra["overtimes"] = max(
            0,
            max(
                len(home.get("linescores") or []),
                len(away.get("linescores") or []),
            ) - 4,
        )
        attendance = _as_int(comp.get("attendance"))
        if attendance:
            extra["attendance"] = attendance
        extra.update(_team_box(home, "home"))
        extra.update(_team_box(away, "away"))

        return (
            GameRow(
                game_id=event_id,
                source="espn",
                competition_id=NBA_COMPETITION_ID,
                season=season,
                season_type=season_type,
                date_utc=date_utc,
                home_team_id=home_id,
                away_team_id=away_id,
                home_score=home_score,
                away_score=away_score,
                extra=extra,
            ),
            None,
        )

    # ------------------------------------------------------------- write

    def load_events(self, events: Sequence[Dict[str, Any]]) -> Dict[str, int]:
        games: List[GameRow] = []
        scheduled: List[ScheduledGameRow] = []
        skipped = 0
        for event in events:
            game, sched = self.parse_event(event)
            if game is not None:
                games.append(game)
            elif sched is not None:
                scheduled.append(sched)
            else:
                skipped += 1

        written = self.wh.upsert_games(games)
        sched_written = self.wh.upsert_scheduled(scheduled)
        # A game that has just been played must leave the scheduled table in
        # the same pass that files its result, or the season simulation keeps
        # simulating a game that already happened.
        pruned = self.wh.prune_played_from_scheduled()
        return {
            "games": written,
            "scheduled": sched_written,
            "skipped": skipped,
            "pruned": pruned,
        }


# --------------------------------------------------------------- helpers


def _as_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalise_date(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    text = str(raw).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _linescores(competitor: Dict[str, Any], side: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for entry in competitor.get("linescores") or []:
        period = _as_int(entry.get("period"))
        if period is None or not 1 <= period <= 4:
            continue
        value = _as_int(entry.get("value"))
        if value is not None:
            out[f"{side}_q{period}"] = value
    return out


def _team_box(competitor: Dict[str, Any], side: str) -> Dict[str, Any]:
    """Box-score columns from a competitor's `statistics` block.

    The scoreboard carries an abbreviated set and the summary endpoint the
    full one; both use the same names, so the same parser reads either.
    """
    out: Dict[str, Any] = {}
    for stat in competitor.get("statistics") or []:
        name = stat.get("name") or stat.get("abbreviation")
        display = stat.get("displayValue")
        if name in _SPLIT_STATS and isinstance(display, str) and "-" in display:
            made_col, att_col = _SPLIT_STATS[name]
            made, _, attempted = display.partition("-")
            if (m := _as_float(made)) is not None:
                out[f"{side}_{made_col}"] = m
            if (a := _as_float(attempted)) is not None:
                out[f"{side}_{att_col}"] = a
        elif name in _SCALAR_STATS:
            value = _as_float(stat.get("value"))
            if value is None:
                value = _as_float(display)
            if value is not None:
                out[f"{side}_{_SCALAR_STATS[name]}"] = value
    return out


def _extract_odds(
    comp: Dict[str, Any], home: Dict[str, Any], away: Dict[str, Any]
) -> Dict[str, Any]:
    """Sportsbook line from a scoreboard event's `odds` block.

    The moneyline is stored as AMERICAN odds exactly as published. Converting
    on the way in would bake one de-vig convention into the stored record;
    `market.py` owns that choice and can be re-run.
    """
    out: Dict[str, Any] = {}
    odds_list = comp.get("odds") or []
    if not odds_list:
        return out
    book = odds_list[0]
    provider = (book.get("provider") or {}).get("name")
    home_odds = book.get("homeTeamOdds") or {}
    away_odds = book.get("awayTeamOdds") or {}
    ml_home = _as_float(home_odds.get("moneyLine"))
    ml_away = _as_float(away_odds.get("moneyLine"))
    if ml_home is not None:
        out["ml_home"] = ml_home
    if ml_away is not None:
        out["ml_away"] = ml_away
    spread = _as_float(book.get("spread"))
    if spread is not None:
        out["spread_home"] = spread
    total = _as_float(book.get("overUnder"))
    if total is not None:
        out["total_points"] = total
    if provider and out:
        out["odds_provider"] = provider
    return out


def _series_id(
    event: Dict[str, Any], comp: Dict[str, Any], season: int, season_type: int
) -> Optional[str]:
    """A stable id for the playoff series a game belongs to.

    Built from the season and the two franchise ids sorted, NOT from the
    round name. ESPN's round vocabulary is inconsistent across seasons
    ("1st Round", "West Conf Semifinals", "Conference Semifinals"), and the
    bracket layer COUNTS depth rather than parsing it, exactly as the soccer
    project's `_assign_depth` does. Two teams can only meet in one series per
    postseason, so the pair plus the season is already unique.
    """
    if season_type != SEASON_TYPE_POSTSEASON:
        return None
    series = comp.get("series") or {}
    if series.get("type") != "playoff":
        return None
    ids = sorted(
        str(c.get("id")) for c in (series.get("competitors") or []) if c.get("id")
    )
    if len(ids) != 2:
        competitors = comp.get("competitors") or []
        ids = sorted(
            str((c.get("team") or {}).get("id"))
            for c in competitors
            if (c.get("team") or {}).get("id")
        )
    if len(ids) != 2:
        return None
    return f"{season}:{ids[0]}v{ids[1]}"
