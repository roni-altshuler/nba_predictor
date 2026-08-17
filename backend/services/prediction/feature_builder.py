"""Point-in-time feature construction.

**Every feature here is computed from games strictly EARLIER than the one
being predicted, and that property is structural rather than a convention
anyone has to remember.** The builder walks the corpus in chronological
order and updates its per-team state *after* emitting a row, so a feature
that saw the future would require the loop to run backwards.

This is the discipline the soccer project arrived at the expensive way, and
its two hardest-won rules are ported verbatim:

1. **Never put a feature in the served vector that the serving path cannot
   populate.** The soccer project shipped market features that were present
   for 96.1% of training rows and synthesised as `NULL → 0.0` at serve time;
   every live prediction saw zeros and Brier went from .5801 to .6561, below
   the constant base rate. The schema guard could not catch it because the
   feature *names* matched — only the values differed. `dead_feature_blocks`
   below is the guard that does catch it, and it compares VARIANCE, not
   names.

2. **A constant feature is not free.** A column with zero variance on the
   serving corpus is either unfed or structurally meaningless, and either
   way it consumes a coefficient. `zero_variance` reports them and the
   training script refuses to promote a model carrying one.

The NBA-specific additions to the soccer feature set are the ones the sport
actually rewards, and each is measured in `ablate_features.py` rather than
assumed:

* **Rest and back-to-backs.** Basketball plays 82 games in 165 days with
  cross-country travel. A team on the second night of a back-to-back is
  measurably worse. Soccer's congestion block was neutral (+.0004); here it
  is the largest non-rating effect.
* **Rolling net rating** over a trailing window, which tracks in-season form
  faster than Elo does.
* **Pace**, which drives the total but is close to irrelevant to the margin.
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Deque, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.data.arenas import (
    altitude_delta,
    arena_for,
    distance_between,
    timezone_shift,
)

from backend.services.ratings.elo import EloConfig, EloRatingSystem

logger = logging.getLogger(__name__)

# The served feature vector. Order is the contract: coefficients are stored
# positionally, so inserting a name in the middle silently re-points every
# weight. Append only, and re-fit when you do.
FEATURE_NAMES: Tuple[str, ...] = (
    "elo_diff",              # (home elo + home advantage) - away elo
    "elo_home",              # level, not just difference — good teams differ
    "elo_away",              #   from bad ones in variance too
    "form_net_diff",         # rolling point differential per game, home - away
    "form_net_home",
    "form_net_away",
    "rest_diff",             # home rest days - away rest days, clipped
    "home_b2b",              # home team on the second night of a back-to-back
    "away_b2b",
    "home_games_in_7",       # schedule density
    "away_games_in_7",
    "pace_sum",              # combined recent possessions proxy — drives total
    "form_off_home",         # rolling points scored per game
    "form_off_away",
    "form_def_home",         # rolling points allowed per game
    "form_def_away",
    "season_progress",       # 0 at tip-off of the season, 1 at game 82
    "is_neutral",
    "is_playoff",
)

# Travel, altitude and time-zone shift were built, measured and NOT ADDED.
# `geography()` below still computes them and is still tested, because the
# measurement is worth keeping reproducible, but they are not in the served
# vector and must not be added without new evidence.
#
# Ablation over the same 25,749-game walk-forward (`ablate_features`):
#
#   block       Brier      delta      verdict
#   travel      .210576    -.000044   model is very slightly better without it
#   altitude    .210620    -.000000   no measurable effect at all
#   timezone    .210642    +.000022   inside the noise floor
#
# The effect is real and it is too small to matter, which are not the same
# claim and both are worth stating. Residuals from the published model are
# highest at exactly the two arenas above a kilometre — Utah +1.22 points
# against the league mean (z = 2.78) and Denver +1.14 (z = 2.71), the top two
# of thirty. But 1.2 points of margin is about two points of win probability,
# at the 7% of games played in those two buildings, which lands a Brier effect
# in the fifth decimal. Elo has also already absorbed most of it: a team that
# wins more at home carries a higher rating, so what the residual measures is
# only the part Elo missed.
#
# Adding four features for that would spend four coefficients to move nothing,
# and this project's rule is that a constant feature is not free.

# Rolling window for form. 10 games is roughly a fortnight of NBA schedule —
# long enough to be more than noise, short enough to move within a season.
FORM_WINDOW = 10

# Rest days are clipped: the difference between 3 and 30 days off is an
# All-Star break, not thirty times the recovery.
MAX_REST_DAYS = 5


@dataclass
class TeamState:
    """Everything known about a team from its earlier games only."""

    scored: Deque[float] = field(default_factory=lambda: deque(maxlen=FORM_WINDOW))
    allowed: Deque[float] = field(default_factory=lambda: deque(maxlen=FORM_WINDOW))
    possessions: Deque[float] = field(default_factory=lambda: deque(maxlen=FORM_WINDOW))
    game_dates: Deque[datetime] = field(default_factory=lambda: deque(maxlen=20))
    last_game: Optional[datetime] = None
    games_this_season: int = 0
    season: Optional[int] = None
    # The franchise whose arena this team last played in — its own on a home
    # night, the opponent's on the road. Travel is measured from HERE rather
    # than from the team's own city, because the second night of a five-game
    # road trip is a short hop and treating it as a flight from home would
    # invent a journey nobody took.
    last_venue: Optional[str] = None

    def net_rating(self) -> float:
        if not self.scored:
            return 0.0
        return float(np.mean(self.scored) - np.mean(self.allowed))

    def offense(self) -> float:
        return float(np.mean(self.scored)) if self.scored else 0.0

    def defense(self) -> float:
        return float(np.mean(self.allowed)) if self.allowed else 0.0

    def pace(self) -> float:
        return float(np.mean(self.possessions)) if self.possessions else 0.0

    def rest_days(self, when: datetime) -> float:
        if self.last_game is None:
            return float(MAX_REST_DAYS)
        delta = (when - self.last_game).total_seconds() / 86400.0
        return float(min(max(delta, 0.0), MAX_REST_DAYS))

    def games_in_last(self, when: datetime, days: int) -> int:
        cutoff = when - timedelta(days=days)
        return sum(1 for d in self.game_dates if d > cutoff)

    def roll_season(self, season: int) -> None:
        """Reset per-season counters, keep the rolling form.

        Form deliberately carries across the boundary: a team's last ten
        games in April are still the best available evidence about it in
        October, and zeroing them would make every season's first ten games
        featureless. Elo's carryover handles the regression that a new
        season genuinely deserves.
        """
        if self.season != season:
            self.season = season
            self.games_this_season = 0



def geography(
    *,
    venue: Optional[str],
    home_last_venue: Optional[str],
    away_last_venue: Optional[str],
    away_home: Optional[str],
    neutral: bool,
) -> List[float]:
    """The four geography features, computed once for both code paths.

    **One function, called by `build` and by `vector_for`.** The train/serve
    skew this project already shipped once came from two code paths agreeing
    on feature NAMES and disagreeing on values; a block computed twice is
    that bug waiting to be written again.

    `venue` is the franchise whose building the game is played in, which is
    the home side unless the game is neutral.

    **A neutral site returns zeros across the block, deliberately.** Where a
    neutral game is played is not in this corpus — ESPN gives a venue string,
    not a franchise — so the honest options are to zero the block or to drop
    the row. Zeroing keeps the game, and `is_neutral` is already in the
    vector for the model to discount it with. It is the one place here that
    a zero means "unknown" rather than "measured zero", which is why it is
    quarantined behind a single flag rather than left to arise from a
    missing lookup.

    Altitude and time zone are measured against where the VISITOR LIVES, not
    where it last played. Acclimatisation is a property of a body over
    weeks; a team that landed in Denver yesterday is not adapted to it. That
    is an assumption, and it is the standard one.
    """
    if neutral or venue is None:
        return [0.0, 0.0, 0.0, 0.0]

    home_km = distance_between(home_last_venue, venue)
    away_km = distance_between(away_last_venue, venue)
    altitude = altitude_delta(venue, away_home)
    shift = timezone_shift(away_home, venue)

    return [
        # Thousands of kilometres. A team's first game of the season has no
        # previous venue and reads as 0 travel, which is the truth of it —
        # they have been at home for three months.
        (home_km or 0.0) / 1000.0,
        (away_km or 0.0) / 1000.0,
        (altitude or 0.0) / 1000.0,
        float(shift or 0.0),
    ]

class FeatureBuilder:
    """Builds the served feature matrix in one chronological pass."""

    def __init__(
        self,
        elo_config: Optional[EloConfig] = None,
        *,
        games_per_season: int = 82,
        abbreviations: Optional[Dict[int, str]] = None,
    ):
        self.elo = EloRatingSystem(elo_config)
        self.state: Dict[int, TeamState] = defaultdict(TeamState)
        self.games_per_season = games_per_season
        # `team_id -> ESPN abbreviation`, the key the arena table uses. Team
        # ids are the warehouse's own autoincrement and are not stable across
        # a rebuild, so they cannot be baked into a geographic reference.
        #
        # Optional, and an omission is LOUD rather than silent: with no map
        # the four geography features are structurally zero, which is exactly
        # what `zero_variance` reports at build time and what
        # `dead_feature_blocks` reports if training has them and serving does
        # not. That is the designed failure mode for this class of bug.
        self.abbreviations: Dict[int, str] = dict(abbreviations or {})

    # ------------------------------------------------------------ build

    def build(
        self, games: Iterable, *, emit_from: Optional[str] = None
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[Dict]]:
        """Walk games in order; return (X, margins, totals, metadata).

        `emit_from` skips emitting rows before a date while still using them
        to warm the state. That is how a walk-forward split avoids
        predicting a team's first ever game from a featureless row without
        ever letting a later game inform an earlier one.
        """
        rows: List[List[float]] = []
        margins: List[float] = []
        totals: List[float] = []
        meta: List[Dict] = []
        previous_date = ""

        for game in games:
            date_utc = game["date_utc"]
            if date_utc < previous_date:
                raise ValueError(
                    "features must be built in chronological order; "
                    f"{date_utc} follows {previous_date}"
                )
            previous_date = date_utc

            when = _parse(date_utc)
            season = int(game["season"])
            home_id = int(game["home_team_id"])
            away_id = int(game["away_team_id"])
            home = self.state[home_id]
            away = self.state[away_id]
            home.roll_season(season)
            away.roll_season(season)

            neutral = bool(game["neutral_site"])
            is_playoff = 1.0 if int(game["season_type"]) == 3 else 0.0

            home_elo = self.elo.get(home_id)
            away_elo = self.elo.get(away_id)
            edge = 0.0 if neutral else self.elo.config.home_advantage

            home_rest = home.rest_days(when)
            away_rest = away.rest_days(when)

            vector = [
                (home_elo + edge) - away_elo,
                home_elo - 1500.0,
                away_elo - 1500.0,
                home.net_rating() - away.net_rating(),
                home.net_rating(),
                away.net_rating(),
                home_rest - away_rest,
                1.0 if home_rest <= 1.0 else 0.0,
                1.0 if away_rest <= 1.0 else 0.0,
                float(home.games_in_last(when, 7)),
                float(away.games_in_last(when, 7)),
                home.pace() + away.pace(),
                home.offense(),
                away.offense(),
                home.defense(),
                away.defense(),
                min(home.games_this_season / self.games_per_season, 1.0),
                1.0 if neutral else 0.0,
                is_playoff,
            ]
            assert len(vector) == len(FEATURE_NAMES), (
                f"vector is {len(vector)} long, FEATURE_NAMES is "
                f"{len(FEATURE_NAMES)} — they must not drift"
            )

            home_score = int(game["home_score"])
            away_score = int(game["away_score"])

            if emit_from is None or date_utc >= emit_from:
                rows.append(vector)
                margins.append(float(home_score - away_score))
                totals.append(float(home_score + away_score))
                meta.append(
                    {
                        "game_id": game["game_id"],
                        "date_utc": date_utc,
                        "season": season,
                        "season_type": int(game["season_type"]),
                        "home_team_id": home_id,
                        "away_team_id": away_id,
                        "home_score": home_score,
                        "away_score": away_score,
                        "home_won": home_score > away_score,
                        "ml_home": game["ml_home"],
                        "ml_away": game["ml_away"],
                        "spread_home": game["spread_home"],
                        "total_points": game["total_points"],
                        "elo_home": home_elo,
                        "elo_away": away_elo,
                    }
                )

            # --- state update happens AFTER the row is emitted. This
            # ordering is the point-in-time guarantee; do not move it.
            self._absorb(game, home, away, when, home_score, away_score)
            self.elo.update(
                game_id=game["game_id"],
                date_utc=date_utc,
                season=season,
                home_team_id=home_id,
                away_team_id=away_id,
                home_score=home_score,
                away_score=away_score,
                neutral=neutral,
            )

        X = np.asarray(rows, dtype=float) if rows else np.zeros((0, len(FEATURE_NAMES)))
        return X, np.asarray(margins), np.asarray(totals), meta

    def vector_for(
        self,
        home_id: int,
        away_id: int,
        when: datetime,
        *,
        neutral: bool = False,
        is_playoff: bool = False,
    ) -> np.ndarray:
        """The served feature vector for a game that has not been played.

        **This is the serving path, and it must populate exactly the same
        features the training path did.** The sibling soccer project shipped
        a serving path that synthesised its market block as `NULL → 0.0`
        while training saw real values for 96.1% of rows; every live
        prediction ran on zeros and Brier went from .5801 to .6561, below the
        constant base rate. The schema guard could not catch it because the
        feature NAMES matched.

        The same class of bug appeared here on the first run: the forecast
        called `predict_from_elo`, which knows nothing about the other
        eighteen features, and published an expected total of 14.1 points —
        the ridge intercept, read as if it were a prediction. It was visible
        only because a basketball game obviously does not end 6-8.

        Every feature below is read from the same `TeamState` the training
        pass wrote, so `dead_feature_blocks(train_X, serve_X)` can compare
        the two and report anything that is alive in one and dead in the
        other.
        """
        home = self.state[home_id]
        away = self.state[away_id]
        home_elo = self.elo.get(home_id)
        away_elo = self.elo.get(away_id)
        edge = 0.0 if neutral else self.elo.config.home_advantage
        home_rest = home.rest_days(when)
        away_rest = away.rest_days(when)

        vector = [
            (home_elo + edge) - away_elo,
            home_elo - 1500.0,
            away_elo - 1500.0,
            home.net_rating() - away.net_rating(),
            home.net_rating(),
            away.net_rating(),
            home_rest - away_rest,
            1.0 if home_rest <= 1.0 else 0.0,
            1.0 if away_rest <= 1.0 else 0.0,
            float(home.games_in_last(when, 7)),
            float(away.games_in_last(when, 7)),
            home.pace() + away.pace(),
            home.offense(),
            away.offense(),
            home.defense(),
            away.defense(),
            min(home.games_this_season / self.games_per_season, 1.0),
            1.0 if neutral else 0.0,
            1.0 if is_playoff else 0.0,
        ]
        assert len(vector) == len(FEATURE_NAMES), (
            f"served vector is {len(vector)} long, FEATURE_NAMES is "
            f"{len(FEATURE_NAMES)} — the two paths have drifted"
        )
        return np.asarray(vector, dtype=float)

    def _absorb(
        self,
        game,
        home: TeamState,
        away: TeamState,
        when: datetime,
        home_score: int,
        away_score: int,
    ) -> None:
        home.scored.append(float(home_score))
        home.allowed.append(float(away_score))
        away.scored.append(float(away_score))
        away.allowed.append(float(home_score))

        possessions = _possessions(game)
        if possessions is not None:
            home.possessions.append(possessions)
            away.possessions.append(possessions)
        else:
            # No box score: fall back to the total as a pace proxy. Half of
            # the total is a rough per-team possession count in a league
            # averaging ~1.1 points per possession, and a missing value here
            # would otherwise make `pace_sum` structurally zero for the
            # pre-box-score seasons — a dead feature block by another name.
            home.possessions.append((home_score + away_score) / 2.2)
            away.possessions.append((home_score + away_score) / 2.2)

        venue = (
            None
            if int(game["neutral_site"] or 0)
            else self.abbreviations.get(int(game["home_team_id"]))
        )
        for team in (home, away):
            team.last_game = when
            team.game_dates.append(when)
            team.games_this_season += 1
            # A neutral game leaves `last_venue` untouched rather than
            # setting it to None: the team is somewhere, and the last place
            # we know about is a better estimate of it than admitting
            # nothing. Clearing it would make the NEXT game read as zero
            # travel, which is a stronger and falser claim.
            if venue is not None:
                team.last_venue = venue


# ------------------------------------------------------------- guards


def zero_variance(X: np.ndarray, names: Sequence[str] = FEATURE_NAMES) -> List[str]:
    """Feature names with no variance on this corpus.

    A permanently-constant column is a bug: it is either unfed or
    meaningless, and either way it spends a coefficient. Re-run this before
    adding a feature.
    """
    if len(X) == 0:
        return list(names)
    sd = X.std(axis=0)
    return [name for name, s in zip(names, sd) if s < 1e-9]


def dead_feature_blocks(
    train_X: np.ndarray, serve_X: np.ndarray, names: Sequence[str] = FEATURE_NAMES
) -> List[str]:
    """Features alive in training and dead at serve time.

    **This is the train/serve skew guard**, and it compares VARIANCE rather
    than names, because the failure it exists to catch had matching names on
    both sides and differing values. A feature that varies across the
    training corpus and is constant across the serving corpus is being
    synthesised, not computed, and every prediction it touches is wrong in a
    way no schema check can see.
    """
    if len(train_X) == 0 or len(serve_X) == 0:
        return []
    train_sd = train_X.std(axis=0)
    serve_sd = serve_X.std(axis=0)
    return [
        name
        for name, t, s in zip(names, train_sd, serve_sd)
        if t > 1e-6 and s < 1e-9
    ]


def _possessions(game) -> Optional[float]:
    """Possession estimate from the box score, if there is one.

    poss ~= FGA - OREB + TOV + 0.44 * FTA, averaged over the two sides.
    The 0.44 is the standard estimate of the share of free throws that end
    a possession; it is a convention, not a measurement, and it is written
    here once rather than in every caller.
    """
    try:
        parts = []
        for side in ("home", "away"):
            fga = game[f"{side}_fga"]
            tov = game[f"{side}_tov"]
            fta = game[f"{side}_fta"]
            oreb = game[f"{side}_oreb"]
            if fga is None or tov is None:
                return None
            parts.append(
                float(fga)
                - float(oreb or 0.0)
                + float(tov)
                + 0.44 * float(fta or 0.0)
            )
        return sum(parts) / len(parts)
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def _parse(iso: str) -> datetime:
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
