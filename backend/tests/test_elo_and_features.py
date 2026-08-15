"""Elo ratings and point-in-time feature construction.

The theme of this file is that a rating or a feature which saw the future
produces output that looks completely normal. These tests are the only thing
standing between that bug and a benchmark that quietly reports a fiction.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from backend.services.prediction.feature_builder import (
    FEATURE_NAMES,
    FeatureBuilder,
    dead_feature_blocks,
    zero_variance,
)
from backend.services.ratings.elo import (
    DEFAULTS,
    BASE_RATING,
    EloConfig,
    EloRatingSystem,
    fit_home_advantage,
)


def _row(game_id, date, home, away, hs, as_, season=2020, season_type=2, neutral=0):
    """A warehouse-shaped row. sqlite3.Row is not constructible, so this
    mimics the mapping access the production code uses."""
    return {
        "game_id": game_id,
        "date_utc": date,
        "season": season,
        "season_type": season_type,
        "home_team_id": home,
        "away_team_id": away,
        "home_score": hs,
        "away_score": as_,
        "neutral_site": neutral,
        "ml_home": None,
        "ml_away": None,
        "spread_home": None,
        "total_points": None,
        "home_fga": None, "home_tov": None, "home_fta": None, "home_oreb": None,
        "away_fga": None, "away_tov": None, "away_fta": None, "away_oreb": None,
    }


def _sequence(n=40, start="2020-01-01T00:00:00+00:00"):
    base = datetime.fromisoformat(start)
    rows = []
    for i in range(n):
        home, away = (1, 2) if i % 2 == 0 else (2, 1)
        hs, as_ = (110, 100) if home == 1 else (100, 110)
        rows.append(
            _row(
                f"g{i}",
                (base + timedelta(days=2 * i)).isoformat(),
                home,
                away,
                hs,
                as_,
            )
        )
    return rows


class TestEloBasics:
    def test_unknown_team_starts_at_the_base_rating(self):
        assert EloRatingSystem().get(999) == BASE_RATING

    def test_a_win_raises_the_winner_and_lowers_the_loser(self):
        elo = EloRatingSystem()
        rated = elo.update(
            game_id="g", date_utc="2020-01-01T00:00:00+00:00", season=2020,
            home_team_id=1, away_team_id=2, home_score=110, away_score=100,
        )
        assert elo.get(1) > rated.home_elo
        assert elo.get(2) < rated.away_elo

    def test_rating_is_zero_sum(self):
        elo = EloRatingSystem()
        elo.update(
            game_id="g", date_utc="2020-01-01T00:00:00+00:00", season=2020,
            home_team_id=1, away_team_id=2, home_score=130, away_score=90,
        )
        assert elo.get(1) + elo.get(2) == pytest.approx(2 * BASE_RATING)

    def test_a_bigger_win_moves_the_rating_further(self):
        def move(margin):
            elo = EloRatingSystem()
            elo.update(
                game_id="g", date_utc="2020-01-01T00:00:00+00:00", season=2020,
                home_team_id=1, away_team_id=2, home_score=100 + margin,
                away_score=100,
            )
            return elo.get(1) - BASE_RATING

        assert move(1) < move(10) < move(30)

    def test_margin_of_victory_has_diminishing_returns(self):
        """Thirty points is more evidence than one, but not thirty times."""
        def move(margin):
            elo = EloRatingSystem()
            elo.update(
                game_id="g", date_utc="2020-01-01T00:00:00+00:00", season=2020,
                home_team_id=1, away_team_id=2, home_score=100 + margin,
                away_score=100,
            )
            return elo.get(1) - BASE_RATING

        assert move(30) < 10 * move(3)

    def test_home_advantage_shows_up_in_the_expectation(self):
        elo = EloRatingSystem()
        assert elo.expected_score(1500, 1500) > 0.5
        assert elo.expected_score(1500, 1500, neutral=True) == pytest.approx(0.5)


class TestSeasonRegression:
    def test_ratings_regress_at_a_season_boundary(self):
        elo = EloRatingSystem()
        elo.update(
            game_id="a", date_utc="2020-01-01T00:00:00+00:00", season=2020,
            home_team_id=1, away_team_id=2, home_score=130, away_score=90,
        )
        strong = elo.get(1)
        elo.update(
            game_id="b", date_utc="2020-11-01T00:00:00+00:00", season=2021,
            home_team_id=3, away_team_id=4, home_score=100, away_score=99,
        )
        assert elo.get(1) < strong

    def test_regression_uses_the_measured_carryover(self):
        """0.60 is the swept optimum, and the OPPOSITE of soccer's answer.

        Pinned as a value test because it is the setting most likely to be
        'corrected' by someone porting a conclusion across sports.
        """
        assert DEFAULTS["carryover"] == 0.60

    def test_regress_to_season_is_idempotent_for_a_started_season(self):
        elo = EloRatingSystem()
        elo.update(
            game_id="a", date_utc="2020-01-01T00:00:00+00:00", season=2020,
            home_team_id=1, away_team_id=2, home_score=130, away_score=90,
        )
        assert elo.regress_to_season(2021) is True
        after = elo.get(1)
        # Asking again for a season already regressed must not compound.
        assert elo.regress_to_season(2021) is False
        assert elo.get(1) == after

    def test_regress_to_season_refuses_to_go_backwards(self):
        elo = EloRatingSystem()
        elo.update(
            game_id="a", date_utc="2021-01-01T00:00:00+00:00", season=2021,
            home_team_id=1, away_team_id=2, home_score=130, away_score=90,
        )
        assert elo.regress_to_season(2020) is False

    def test_regression_moves_every_team_including_the_idle(self):
        elo = EloRatingSystem()
        elo.set(7, 1800.0)
        elo._last_season = 2020
        elo.regress_to_season(2021)
        assert elo.get(7) == pytest.approx(0.60 * 1800 + 0.40 * 1500)


class TestOrdering:
    def test_out_of_order_games_are_refused(self):
        """Elo over an unordered stream reads the future, and the output
        looks entirely normal. This exception is the only signal."""
        rows = [
            _row("a", "2020-02-01T00:00:00+00:00", 1, 2, 110, 100),
            _row("b", "2020-01-01T00:00:00+00:00", 1, 2, 110, 100),
        ]
        with pytest.raises(ValueError, match="out of order"):
            EloRatingSystem().run(rows)

    def test_in_order_games_are_accepted(self):
        assert len(EloRatingSystem().run(_sequence(10))) == 10


class TestFitHomeAdvantage:
    def test_returns_none_below_the_minimum(self):
        assert fit_home_advantage(_sequence(4), minimum=200) is None

    def test_recovers_a_positive_edge(self):
        # 60% home wins, which is roughly the 2000s NBA rate. A corpus where
        # the home side wins EVERY game has an undefined rating edge (the
        # logit diverges) and the function correctly returns None for it.
        rows = []
        for i in range(300):
            home_wins = i % 5 < 3
            rows.append(
                _row(
                    f"g{i}",
                    f"2020-01-{i % 28 + 1:02d}T00:00:00+00:00",
                    1, 2,
                    110 if home_wins else 100,
                    100 if home_wins else 110,
                )
            )
        edge = fit_home_advantage(rows)
        assert edge is not None and edge > 0

    def test_returns_none_when_the_home_side_never_loses(self):
        rows = [
            _row(f"g{i}", f"2020-01-{i % 28 + 1:02d}T00:00:00+00:00", 1, 2, 110, 100)
            for i in range(300)
        ]
        assert fit_home_advantage(rows) is None


class TestPointInTime:
    def test_features_never_see_the_game_they_describe(self):
        """The first game between two teams must carry no form.

        State is updated AFTER a row is emitted, so the opening game of a
        corpus is featureless by construction. If this ever returns a
        non-zero net rating, the update has moved above the emit.
        """
        builder = FeatureBuilder()
        X, _, _, meta = builder.build(_sequence(6))
        net_home_index = FEATURE_NAMES.index("form_net_home")
        assert X[0][net_home_index] == 0.0

    def test_elo_in_metadata_is_the_pre_game_value(self):
        builder = FeatureBuilder()
        _, _, _, meta = builder.build(_sequence(6))
        assert meta[0]["elo_home"] == BASE_RATING
        # By the second game the winner's rating has moved.
        assert meta[1]["elo_away"] != BASE_RATING

    def test_feature_count_matches_the_names(self):
        builder = FeatureBuilder()
        X, _, _, _ = builder.build(_sequence(6))
        assert X.shape[1] == len(FEATURE_NAMES)

    def test_emit_from_warms_state_without_emitting(self):
        builder = FeatureBuilder()
        rows = _sequence(20)
        cutoff = rows[10]["date_utc"]
        X, _, _, meta = builder.build(rows, emit_from=cutoff)
        assert len(meta) == 10
        # The first emitted row has form, because the ten before it warmed
        # the state without being scored.
        net_home_index = FEATURE_NAMES.index("form_net_home")
        assert X[0][net_home_index] != 0.0

    def test_out_of_order_build_is_refused(self):
        rows = [
            _row("a", "2020-02-01T00:00:00+00:00", 1, 2, 110, 100),
            _row("b", "2020-01-01T00:00:00+00:00", 1, 2, 110, 100),
        ]
        with pytest.raises(ValueError, match="chronological"):
            FeatureBuilder().build(rows)


class TestServingPath:
    def test_serving_vector_matches_the_training_width(self):
        builder = FeatureBuilder()
        builder.build(_sequence(20))
        vector = builder.vector_for(
            1, 2, datetime(2021, 1, 1, tzinfo=timezone.utc)
        )
        assert vector.shape == (len(FEATURE_NAMES),)

    def test_serving_vector_is_not_all_zeros(self):
        """The train/serve skew guard, in miniature.

        A serving path that returns zeros for everything looks identical to
        one that works, right up until the published forecast says a
        basketball game will end 6-8.
        """
        builder = FeatureBuilder()
        builder.build(_sequence(20))
        vector = builder.vector_for(
            1, 2, datetime(2021, 1, 1, tzinfo=timezone.utc)
        )
        assert np.abs(vector).sum() > 0

    def test_dead_feature_blocks_detects_a_synthesised_column(self):
        train = np.random.default_rng(0).normal(size=(100, 3))
        serve = train.copy()
        serve[:, 1] = 0.0  # column 1 is alive in training, dead at serve
        assert dead_feature_blocks(train, serve, ["a", "b", "c"]) == ["b"]

    def test_dead_feature_blocks_is_quiet_when_nothing_is_dead(self):
        train = np.random.default_rng(0).normal(size=(100, 3))
        assert dead_feature_blocks(train, train, ["a", "b", "c"]) == []

    def test_zero_variance_flags_a_constant_column(self):
        X = np.column_stack([np.arange(50.0), np.ones(50)])
        assert zero_variance(X, ["moves", "constant"]) == ["constant"]
