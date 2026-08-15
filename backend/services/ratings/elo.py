"""Elo ratings for NBA franchises.

The structural baseline of this project, and the yardstick every later model
must beat. It is the analogue of the soccer project's Elo/Dixon-Coles floor:
cheap, transparent, hard to beat by much, and **never deleted**.

Three basketball-specific choices, each measured rather than assumed —
`backend/scripts/tune_elo.py` sweeps them and writes
`backend/data/diagnostics/elo_sweep.json`:

1. **Margin of victory feeds the update, with diminishing returns.** A
   30-point win is more evidence than a 1-point win, but not thirty times
   more, and garbage-time scoring inflates blowouts. The multiplier is
   `((mov + 3) ** 0.8) / (7.5 + 0.006 * elo_diff)`, whose denominator is the
   autocorrelation correction: without it a strong team beating a weak one
   by 20 gains rating for meeting expectations, and favourites drift upward
   forever.

2. **Ratings regress toward the mean between seasons.** The NBA has a draft,
   a salary cap and free agency, all of which are explicitly designed to
   pull teams together. Carrying a rating forward untouched projects last
   season's champion as this season's champion. Default carryover is 0.75.

   This is the OPPOSITE of the soccer project's finding, where
   season-boundary regression was tested and rejected at every level
   (+.00150 at 0.25, worse at 0.40 and 0.60). Do not port that conclusion
   across sports: European football has no draft and no cap, so its clubs
   genuinely do stay good. The NBA's institutions are built to prevent
   exactly that, and the sweep here confirms it.

3. **Home advantage is a rating offset, and it has been shrinking.** It is
   fitted per season rather than fixed, because the league-wide home win
   rate has fallen from ~.62 in the 2000s to ~.55 in the 2020s and a frozen
   constant would quietly mis-price every game in the modern era.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# The rating every franchise starts from, and the mean seasons regress
# toward. 1500 is conventional; nothing downstream depends on the level,
# only on differences.
BASE_RATING = 1500.0

# Rating points per expected point of margin. Derived, not chosen: with
# K=20 and the MOV multiplier below, a 100-point rating edge is worth
# roughly 3.5 points of margin on this corpus. `margin_model` refits it.
POINTS_PER_ELO = 28.0

# Measured, not chosen. `tune_elo.py` swept 180 configurations over 29,653
# games and scored 15,479 from 2015 onward; full grid in
# `backend/data/diagnostics/elo_sweep.json`. Best: Brier .21488, ECE .00728.
#
# Both non-obvious values are decisive rather than marginal:
#
#   carryover  0.60 .21488 | 0.70 .21495 | 0.75 .21505 | 0.80 .21520
#              0.90 .21564 | 1.00 .21622
#     Monotone. Carrying ratings forward untouched is the WORST setting
#     tested. This is the direct opposite of the soccer project's result,
#     where season-boundary regression was rejected at every level — and
#     the reason is institutional, not statistical: the NBA drafts in
#     reverse order of finish and caps payrolls, European football does
#     neither.
#
#   home_adv   30 .21577/.0301 | 40 .21516/.0191 | 50 .21488/.0073
#              65 .21507/.0144 | 80 .21597/.0329 | 100 .21817/.0558
#     A clean optimum at 50, and note the ECE column: 100 rating points is
#     not merely worse, it is five points overconfident.
DEFAULTS = {
    "k_factor": 20.0,
    "carryover": 0.60,
    "home_advantage": 50.0,
    "mov_exponent": 0.8,
    "mov_offset": 3.0,
    "autocorrelation": 0.006,
    "autocorrelation_base": 7.5,
}

# Home advantage is NOT stable in this sport, and 50 is a compromise across
# the scoring window rather than a fact about today. Measured per era:
#
#   2004-2009  76 pts (home win .6080, margin +3.42)
#   2010-2014  70 pts (home win .5989, margin +2.98)
#   2015-2019  60 pts (home win .5862, margin +2.74)
#   2020-2023  40 pts (home win .5566, margin +1.96)
#   2024-2026  34 pts (home win .5493, margin +2.00)
#
# The served margin model refits monthly and picks the current value up
# through its intercept, so this constant matters most to the Elo-only
# baseline. **Do not treat any single number here as the home advantage.**
HOME_ADVANTAGE_BY_ERA = {
    (2004, 2009): 76.0,
    (2010, 2014): 70.0,
    (2015, 2019): 60.0,
    (2020, 2023): 40.0,
    (2024, 2026): 34.0,
}


@dataclass
class EloConfig:
    k_factor: float = DEFAULTS["k_factor"]
    carryover: float = DEFAULTS["carryover"]
    home_advantage: float = DEFAULTS["home_advantage"]
    mov_exponent: float = DEFAULTS["mov_exponent"]
    mov_offset: float = DEFAULTS["mov_offset"]
    autocorrelation: float = DEFAULTS["autocorrelation"]
    autocorrelation_base: float = DEFAULTS["autocorrelation_base"]
    base_rating: float = BASE_RATING

    def as_dict(self) -> Dict[str, float]:
        return {
            "k_factor": self.k_factor,
            "carryover": self.carryover,
            "home_advantage": self.home_advantage,
            "mov_exponent": self.mov_exponent,
            "mov_offset": self.mov_offset,
            "autocorrelation": self.autocorrelation,
            "autocorrelation_base": self.autocorrelation_base,
            "base_rating": self.base_rating,
        }


@dataclass
class RatedGame:
    """One game's ratings, captured BEFORE it was played.

    `home_elo` / `away_elo` are the pre-game values, which is what a feature
    may use. The post-game values are written back into the rating table and
    are only readable by a later game — see `Warehouse.latest_elo`, which
    takes ratings strictly earlier than the date asked for.
    """

    game_id: str
    date_utc: str
    season: int
    home_team_id: int
    away_team_id: int
    home_elo: float
    away_elo: float
    home_elo_post: float
    away_elo_post: float
    expected_home: float
    home_won: bool
    margin: int


class EloRatingSystem:
    """Rolling Elo over a chronologically ordered stream of games."""

    def __init__(self, config: Optional[EloConfig] = None):
        self.config = config or EloConfig()
        self.ratings: Dict[int, float] = {}
        self._last_season: Optional[int] = None
        self.history: List[RatedGame] = []

    # -------------------------------------------------------------- read

    def get(self, team_id: int) -> float:
        return self.ratings.get(team_id, self.config.base_rating)

    def set(self, team_id: int, rating: float) -> None:
        self.ratings[team_id] = float(rating)

    def expected_score(
        self, home_elo: float, away_elo: float, *, neutral: bool = False
    ) -> float:
        """P(home wins) from the rating difference alone."""
        edge = 0.0 if neutral else self.config.home_advantage
        diff = (home_elo + edge) - away_elo
        return 1.0 / (1.0 + 10.0 ** (-diff / 400.0))

    def expected_margin(
        self, home_elo: float, away_elo: float, *, neutral: bool = False
    ) -> float:
        edge = 0.0 if neutral else self.config.home_advantage
        return ((home_elo + edge) - away_elo) / POINTS_PER_ELO

    # ------------------------------------------------------------ update

    def regress_to_season(self, season: int) -> bool:
        """Apply the offseason regression for a season not yet played.

        **A forecaster must call this and a backtest must not.** The rolling
        update applies carryover lazily, when the first game of a new season
        arrives — which is correct while walking a corpus, and wrong the
        moment you stop walking and start projecting. `forecast_season` fits
        on every game ever played and then asks for ratings for a season
        whose first game does not exist yet, so without this the projection
        runs on END-OF-LAST-SEASON ratings and skips the regression the
        sweep measured as the single most valuable Elo setting.

        Concretely, on the 2026-27 projection: New York finished 2025-26 on
        1790 and would have been projected from it, giving a 43% title
        probability against a market that prices no NBA favourite above the
        mid-20s. Regressed at the measured 0.60 carryover they start at
        1674 and the field opens up.

        Returns True when it did something, so a caller can log it.
        """
        if self._last_season is not None and season <= self._last_season:
            return False
        carry = self.config.carryover
        base = self.config.base_rating
        for team_id, rating in list(self.ratings.items()):
            self.ratings[team_id] = carry * rating + (1.0 - carry) * base
        self._last_season = season
        return True

    def _regress_for_new_season(self, season: int) -> None:
        """Pull every rating toward the mean at a season boundary.

        Applied to EVERY franchise, including ones that did not play last
        season. A team that misses the boundary keeps a stale rating and
        then competes against regressed ones, which is the same bug as
        forgetting to age a cohort.
        """
        if self._last_season is None or season == self._last_season:
            self._last_season = season
            return
        carry = self.config.carryover
        base = self.config.base_rating
        for team_id, rating in list(self.ratings.items()):
            self.ratings[team_id] = carry * rating + (1.0 - carry) * base
        self._last_season = season

    def _mov_multiplier(self, margin: int, elo_diff_winner: float) -> float:
        """Diminishing-returns weight on the margin of victory.

        `elo_diff_winner` is the winner's pre-game rating edge (including
        home advantage). The denominator grows with it, so a favourite
        winning big gains less than an underdog winning big — the
        autocorrelation correction that stops ratings running away.
        """
        cfg = self.config
        numerator = (abs(margin) + cfg.mov_offset) ** cfg.mov_exponent
        denominator = cfg.autocorrelation_base + cfg.autocorrelation * elo_diff_winner
        if denominator <= 0:
            denominator = 1e-6
        return numerator / denominator

    def update(
        self,
        *,
        game_id: str,
        date_utc: str,
        season: int,
        home_team_id: int,
        away_team_id: int,
        home_score: int,
        away_score: int,
        neutral: bool = False,
    ) -> RatedGame:
        """Rate one game and fold the result back in.

        Returns the PRE-game ratings alongside the post-game ones so a
        caller building features never has to reconstruct them, and can
        never accidentally read the post-game value for the game it is
        predicting.
        """
        self._regress_for_new_season(season)

        home_elo = self.get(home_team_id)
        away_elo = self.get(away_team_id)
        expected_home = self.expected_score(home_elo, away_elo, neutral=neutral)

        margin = int(home_score) - int(away_score)
        home_won = margin > 0
        actual = 1.0 if home_won else 0.0

        edge = 0.0 if neutral else self.config.home_advantage
        # The winner's rating edge, which is what the correction is about.
        if home_won:
            elo_diff_winner = (home_elo + edge) - away_elo
        else:
            elo_diff_winner = away_elo - (home_elo + edge)

        multiplier = self._mov_multiplier(margin, elo_diff_winner)
        delta = self.config.k_factor * multiplier * (actual - expected_home)

        home_post = home_elo + delta
        away_post = away_elo - delta
        self.ratings[home_team_id] = home_post
        self.ratings[away_team_id] = away_post

        rated = RatedGame(
            game_id=game_id,
            date_utc=date_utc,
            season=season,
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            home_elo=home_elo,
            away_elo=away_elo,
            home_elo_post=home_post,
            away_elo_post=away_post,
            expected_home=expected_home,
            home_won=home_won,
            margin=margin,
        )
        self.history.append(rated)
        return rated

    # ------------------------------------------------------------- bulk

    def run(self, games: Iterable) -> List[RatedGame]:
        """Rate a chronologically ordered iterable of warehouse game rows.

        **Order is the contract.** Rating a stream out of order silently
        produces ratings that saw the future, and nothing about the output
        looks wrong. Callers use `Warehouse.iter_games`, which sorts on
        `(date_utc, game_id)`.
        """
        out: List[RatedGame] = []
        previous_date = ""
        for row in games:
            date_utc = row["date_utc"]
            if date_utc < previous_date:
                raise ValueError(
                    f"games are out of order: {date_utc} follows {previous_date}. "
                    "Elo over an unordered stream reads the future."
                )
            previous_date = date_utc
            out.append(
                self.update(
                    game_id=row["game_id"],
                    date_utc=date_utc,
                    season=int(row["season"]),
                    home_team_id=int(row["home_team_id"]),
                    away_team_id=int(row["away_team_id"]),
                    home_score=int(row["home_score"]),
                    away_score=int(row["away_score"]),
                    neutral=bool(row["neutral_site"]),
                )
            )
        return out

    def rankings(self, top_n: Optional[int] = None) -> List[Tuple[int, float]]:
        ordered = sorted(self.ratings.items(), key=lambda kv: kv[1], reverse=True)
        return ordered[:top_n] if top_n else ordered

    def snapshot(self) -> Dict[int, float]:
        return dict(self.ratings)


def fit_home_advantage(
    games: Sequence, *, minimum: int = 200
) -> Optional[float]:
    """Home advantage in RATING points, from the observed home win rate.

    Inverts the logistic: a home win rate of p in a corpus of otherwise
    balanced matchups implies a rating edge of `400 * log10(p / (1 - p))`.

    Returns None below `minimum` games rather than a number from a sample
    that cannot support one.
    """
    played = [g for g in games if not g["neutral_site"]]
    if len(played) < minimum:
        return None
    wins = sum(1 for g in played if g["home_score"] > g["away_score"])
    rate = wins / len(played)
    if not 0.0 < rate < 1.0:
        return None
    return 400.0 * math.log10(rate / (1.0 - rate))


_system: Optional[EloRatingSystem] = None


def get_elo_system(config: Optional[EloConfig] = None) -> EloRatingSystem:
    global _system
    if _system is None or config is not None:
        _system = EloRatingSystem(config)
    return _system
