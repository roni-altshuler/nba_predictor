"""The playoff layer: best-of-seven series and the bracket over them.

This is the NBA analogue of the sibling soccer project's knockout-tie layer,
and it exists for the same reason: **a series asks a binary question and
answers it with far less noise than a single game.** In soccer the argument
is that 25.6% of league matches are drawn, so the closing line tops out
around 54% on 1X2 and a two-legged tie is where the sport asks something
cleanly binary. Basketball has no draws to begin with — but it has something
better, which is seven chances to observe the same matchup.

That makes the ladder here steeper than anywhere else in the project:

* A single NBA game: the market lands its side ~67.6% of the time.
* A best-of-seven: the better team wins far more often, because the format
  is explicitly designed to suppress variance.

**A series is NOT one game with a bigger sample, and modelling it as one is
the mistake this module exists to prevent.** Three things break that
approximation, and all three are modelled explicitly:

1. **Home court alternates.** The 2-2-1-1-1 pattern gives the higher seed
   four games at home and three away. Collapsing that into one aggregate
   strength edge misprices every game-7 scenario, which is exactly the
   scenario a reader most wants a number for.
2. **The games are not independent draws from a fixed distribution.** They
   are, near enough, once you condition on both teams — but the *format*
   makes the series probability a non-linear function of the game
   probability, and that function is what a reader is actually asking for.
3. **Series depth is COUNTED, never parsed.** ESPN's round vocabulary is
   inconsistent across seasons — "1st Round", "West Conf Semifinals",
   "Conference Semifinals", "NBA Finals" — and any code that maps a phase
   string to a bracket position will be wrong in the seasons nobody checks.
   `assign_depth` derives the round from the number of series in it, exactly
   as the soccer project's `_assign_depth` does.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# Home-court pattern for a best-of-seven, from the higher seed's point of
# view. The NBA has used 2-2-1-1-1 for every round since 2014 (the Finals
# moved off 2-3-2 that year).
HOME_PATTERN_2_2_1_1_1: Tuple[bool, ...] = (True, True, False, False, True, False, True)

# The pattern the Finals used through 2013. Kept because the backtest reaches
# back to 2004 and scoring a 2009 Finals on today's pattern would be a
# quiet, systematic error in exactly the games that matter most.
HOME_PATTERN_2_3_2: Tuple[bool, ...] = (True, True, False, False, False, True, True)
FINALS_PATTERN_CHANGED_SEASON = 2014


@dataclass
class Series:
    """One playoff series, resolved or pending."""

    series_id: str
    season: int
    round_slug: str
    depth: Optional[int]
    team_a_id: int
    team_b_id: int
    wins_a: int = 0
    wins_b: int = 0
    best_of: int = 7
    winner_id: Optional[int] = None
    first_game_utc: Optional[str] = None
    last_game_utc: Optional[str] = None
    games: List[Dict] = field(default_factory=list)

    @property
    def games_played(self) -> int:
        return self.wins_a + self.wins_b

    @property
    def needed(self) -> int:
        return self.best_of // 2 + 1

    @property
    def completed(self) -> bool:
        return self.winner_id is not None

    def as_dict(self) -> Dict:
        return {
            "series_id": self.series_id,
            "season": self.season,
            "round_slug": self.round_slug,
            "depth": self.depth,
            "team_a_id": self.team_a_id,
            "team_b_id": self.team_b_id,
            "wins_a": self.wins_a,
            "wins_b": self.wins_b,
            "games_played": self.games_played,
            "best_of": self.best_of,
            "winner_id": self.winner_id,
            "completed": self.completed,
            "first_game_utc": self.first_game_utc,
            "last_game_utc": self.last_game_utc,
        }


def build_series(games: Iterable) -> List[Series]:
    """Reconstruct series from postseason game rows.

    Grouped on `series_id`, which the loader derives from the season plus the
    two franchise ids — never from the round name. Two teams can only meet
    once in a postseason, so the pair is already unique, and this sidesteps
    ESPN's inconsistent round vocabulary entirely.
    """
    grouped: Dict[str, List] = defaultdict(list)
    for row in games:
        series_id = row["series_id"]
        if not series_id:
            continue
        grouped[series_id].append(row)

    out: List[Series] = []
    for series_id, rows in grouped.items():
        rows.sort(key=lambda r: r["date_utc"])
        first = rows[0]
        # Orient the series on the team that hosted game 1 — the higher seed
        # under every NBA format. Stored explicitly so nothing downstream has
        # to re-derive seeding from a round name.
        team_a = int(first["home_team_id"])
        team_b = int(first["away_team_id"])
        wins_a = wins_b = 0
        for row in rows:
            home, away = int(row["home_team_id"]), int(row["away_team_id"])
            if {home, away} != {team_a, team_b}:
                logger.warning(
                    "series %s contains a game between other teams — skipping",
                    series_id,
                )
                continue
            home_won = row["home_score"] > row["away_score"]
            winner = home if home_won else away
            if winner == team_a:
                wins_a += 1
            else:
                wins_b += 1

        best_of = 7
        winner_id: Optional[int] = None
        needed = best_of // 2 + 1
        if wins_a >= needed:
            winner_id = team_a
        elif wins_b >= needed:
            winner_id = team_b

        out.append(
            Series(
                series_id=series_id,
                season=int(first["season"]),
                round_slug=str(first["phase"] or "").strip() or "unknown",
                depth=None,
                team_a_id=team_a,
                team_b_id=team_b,
                wins_a=wins_a,
                wins_b=wins_b,
                best_of=best_of,
                winner_id=winner_id,
                first_game_utc=rows[0]["date_utc"],
                last_game_utc=rows[-1]["date_utc"],
                games=[dict(r) for r in rows],
            )
        )
    out.sort(key=lambda s: (s.season, s.first_game_utc or ""))
    return out


def assign_depth(series: Sequence[Series]) -> None:
    """Set `depth` per season by COUNTING series, never by parsing a name.

    Depth 0 is the final, 1 the conference finals, 2 the conference
    semi-finals, 3 the first round. Derived from how many series are played
    in each wave: 8 first-round series, 4 semi-finals, 2 conference finals,
    1 final. A round with an unexpected count is left at None rather than
    guessed, so a malformed season is visible instead of silently misplaced.
    """
    by_season: Dict[int, List[Series]] = defaultdict(list)
    for item in series:
        by_season[item.season].append(item)

    for season, members in by_season.items():
        members.sort(key=lambda s: s.first_game_utc or "")
        # Group into waves by start date: rounds are separated by days, and
        # series inside a round start within a few days of each other.
        waves: List[List[Series]] = []
        for item in members:
            if waves and _days_between(
                waves[-1][-1].first_game_utc, item.first_game_utc
            ) <= 6:
                waves[-1].append(item)
            else:
                waves.append([item])

        # Depth is read off the wave SIZE, which is the reliable signal.
        for wave in waves:
            size = len(wave)
            depth = {8: 3, 4: 2, 2: 1, 1: 0}.get(size)
            if depth is None:
                logger.debug(
                    "season %s: a wave of %d series does not match a known "
                    "round size — leaving depth unset", season, size
                )
            for item in wave:
                item.depth = depth


def _days_between(a: Optional[str], b: Optional[str]) -> float:
    if not a or not b:
        return 999.0
    from datetime import datetime

    da = datetime.fromisoformat(str(a))
    db = datetime.fromisoformat(str(b))
    return abs((db - da).total_seconds()) / 86400.0


# ------------------------------------------------------------ modelling


def series_probability(
    p_home_game: float,
    p_away_game: float,
    *,
    best_of: int = 7,
    pattern: Sequence[bool] = HOME_PATTERN_2_2_1_1_1,
) -> float:
    """P(the higher seed wins the series), computed EXACTLY.

    `p_home_game` is the higher seed's win probability at home;
    `p_away_game` is its win probability on the road. They are different
    numbers, which is the whole reason this is not a binomial.

    Enumerated over every game sequence rather than simulated: a
    best-of-seven has at most 2^7 paths, so the exact answer is cheaper than
    a Monte Carlo estimate of it and carries no sampling noise. The soccer
    project's equivalent lesson — enumerate reachable pairings, do not cache
    lazily — turned a twenty-minute backtest into a two-minute one.
    """
    needed = best_of // 2 + 1
    memo: Dict[Tuple[int, int], float] = {}

    def recurse(wins: int, losses: int) -> float:
        if wins >= needed:
            return 1.0
        if losses >= needed:
            return 0.0
        key = (wins, losses)
        if key in memo:
            return memo[key]
        game_index = wins + losses
        at_home = pattern[game_index] if game_index < len(pattern) else True
        p_win = p_home_game if at_home else p_away_game
        value = p_win * recurse(wins + 1, losses) + (1.0 - p_win) * recurse(
            wins, losses + 1
        )
        memo[key] = value
        return value

    return recurse(0, 0)


def series_length_distribution(
    p_home_game: float,
    p_away_game: float,
    *,
    best_of: int = 7,
    pattern: Sequence[bool] = HOME_PATTERN_2_2_1_1_1,
) -> Dict[str, float]:
    """P(series ends in 4/5/6/7 games), split by which side wins.

    Exact, by the same enumeration. This is what makes a series card say
    something a single number cannot — "in 6" is the modal outcome of most
    real series and a reader recognises it.

    **Returned unrounded, and that is the fix for a real bug.** This used to
    round each bucket to six places, which is a serialisation concern that
    was quietly breaking the function's own invariant: sixteen buckets each
    off by up to 5e-7 put the total as much as 1e-6 from one. The test that
    asserts the distribution sums to one uses `pytest.approx`, whose default
    tolerance is RELATIVE 1e-6 — so the sum landed exactly on the knife
    edge, passed on Python 3.11 and failed on 3.12 in CI. A probability
    distribution must not lose mass on the way out of the function that
    computed it; rounding belongs at the JSON boundary, where the callers
    now do it.
    """
    needed = best_of // 2 + 1
    out: Dict[str, float] = defaultdict(float)

    def recurse(wins: int, losses: int, probability: float) -> None:
        if wins >= needed:
            out[f"higher_in_{wins + losses}"] += probability
            return
        if losses >= needed:
            out[f"lower_in_{wins + losses}"] += probability
            return
        game_index = wins + losses
        at_home = pattern[game_index] if game_index < len(pattern) else True
        p_win = p_home_game if at_home else p_away_game
        recurse(wins + 1, losses, probability * p_win)
        recurse(wins, losses + 1, probability * (1.0 - p_win))

    recurse(0, 0, 1.0)
    return dict(sorted(out.items()))


def conditional_series_probability(
    wins_higher: int,
    wins_lower: int,
    p_home_game: float,
    p_away_game: float,
    *,
    best_of: int = 7,
    pattern: Sequence[bool] = HOME_PATTERN_2_2_1_1_1,
) -> float:
    """P(higher seed advances) given a series already in progress.

    The number a reader wants once a series is 2-1: not the pre-series
    probability, and not a fresh best-of-four. The remaining games keep
    their real home/away slots, which is why this takes the games already
    played rather than just the deficit.
    """
    needed = best_of // 2 + 1
    if wins_higher >= needed:
        return 1.0
    if wins_lower >= needed:
        return 0.0
    memo: Dict[Tuple[int, int], float] = {}

    def recurse(wins: int, losses: int) -> float:
        if wins >= needed:
            return 1.0
        if losses >= needed:
            return 0.0
        key = (wins, losses)
        if key in memo:
            return memo[key]
        game_index = wins + losses
        at_home = pattern[game_index] if game_index < len(pattern) else True
        p_win = p_home_game if at_home else p_away_game
        value = p_win * recurse(wins + 1, losses) + (1.0 - p_win) * recurse(
            wins, losses + 1
        )
        memo[key] = value
        return value

    return recurse(wins_higher, wins_lower)


def pattern_for(season: int, depth: Optional[int]) -> Tuple[bool, ...]:
    """The home-court pattern a given round actually used.

    The Finals ran 2-3-2 through 2013 and 2-2-1-1-1 from 2014. Every other
    round has always been 2-2-1-1-1. Scoring an old Finals on the modern
    pattern is a small, systematic error concentrated in the highest-profile
    series in the corpus.
    """
    if depth == 0 and season < FINALS_PATTERN_CHANGED_SEASON:
        return HOME_PATTERN_2_3_2
    return HOME_PATTERN_2_2_1_1_1
