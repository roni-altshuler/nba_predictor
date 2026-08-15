"""The playoff-series layer."""

from __future__ import annotations

import pytest

from backend.services.playoffs.series import (
    FINALS_PATTERN_CHANGED_SEASON,
    HOME_PATTERN_2_2_1_1_1,
    HOME_PATTERN_2_3_2,
    assign_depth,
    build_series,
    conditional_series_probability,
    pattern_for,
    series_length_distribution,
    series_probability,
)


def _game(gid, date, home, away, hs, as_, series_id, season=2024, phase="1st Round"):
    return {
        "game_id": gid,
        "date_utc": date,
        "season": season,
        "season_type": 3,
        "home_team_id": home,
        "away_team_id": away,
        "home_score": hs,
        "away_score": as_,
        "series_id": series_id,
        "phase": phase,
        "neutral_site": 0,
    }


class TestSeriesProbability:
    def test_even_teams_on_a_neutral_pattern_is_a_coin_flip(self):
        assert series_probability(0.5, 0.5) == pytest.approx(0.5)

    def test_a_better_team_wins_a_series_more_often_than_a_game(self):
        """The whole reason a series is a different question.

        Seven games suppress variance: a side that wins 60% of individual
        games wins the series far more than 60% of the time.
        """
        game = 0.60
        series = series_probability(game, game)
        assert series > game
        assert series == pytest.approx(0.71, abs=0.02)

    def test_home_and_road_probabilities_are_used_separately(self):
        """A series is not a binomial. Feeding one probability for both
        venues throws away the 4-3 home split that defines the format."""
        symmetric = series_probability(0.65, 0.65)
        realistic = series_probability(0.72, 0.55)
        assert symmetric != pytest.approx(realistic, abs=1e-6)

    def test_monotone_in_the_game_probability(self):
        values = [series_probability(p, p - 0.1) for p in (0.4, 0.5, 0.6, 0.7, 0.8)]
        assert values == sorted(values)

    def test_a_certain_team_wins_certainly(self):
        assert series_probability(1.0, 1.0) == pytest.approx(1.0)
        assert series_probability(0.0, 0.0) == pytest.approx(0.0)

    def test_best_of_five_is_noisier_than_best_of_seven(self):
        """Fewer games means less variance suppression, so the favourite's
        edge shrinks."""
        seven = series_probability(0.65, 0.55, best_of=7)
        five = series_probability(0.65, 0.55, best_of=5)
        assert five < seven


class TestSeriesLength:
    def test_distribution_sums_to_one(self):
        """Every path leads somewhere, so the mass has to be there.

        This test caught a real bug rather than a tolerance problem. The
        function used to round each bucket to six places on the way out;
        sixteen buckets each off by up to 5e-7 left the total as much as
        1e-6 from one, which is EXACTLY `pytest.approx`'s default relative
        tolerance. It passed on Python 3.11 and failed on 3.12 in CI. The
        rounding moved to the JSON boundary, where it belongs — so this now
        holds to float precision, and the tight default tolerance is the
        point of the test.
        """
        dist = series_length_distribution(0.65, 0.55)
        assert sum(dist.values()) == pytest.approx(1.0)

    def test_it_sums_to_one_across_the_whole_parameter_grid(self):
        """Not just at one lucky pair of inputs.

        The knife-edge above was invisible for exactly this reason: a single
        sample sat one ULP inside the tolerance.
        """
        for home in (i / 20 for i in range(1, 20)):
            for away in (j / 20 for j in range(1, 20)):
                total = sum(series_length_distribution(home, away).values())
                assert total == pytest.approx(1.0, abs=1e-12)

    def test_only_valid_lengths_appear(self):
        dist = series_length_distribution(0.65, 0.55)
        lengths = {int(k.rsplit("_", 1)[1]) for k in dist}
        assert lengths <= {4, 5, 6, 7}

    def test_it_agrees_with_the_series_probability(self):
        """The two must be the same model, not two models that resemble
        each other."""
        dist = series_length_distribution(0.7, 0.55)
        higher = sum(v for k, v in dist.items() if k.startswith("higher"))
        assert higher == pytest.approx(series_probability(0.7, 0.55))

    def test_a_dominant_team_sweeps_more_often(self):
        strong = series_length_distribution(0.9, 0.85)
        weak = series_length_distribution(0.55, 0.45)
        assert strong["higher_in_4"] > weak["higher_in_4"]


class TestConditional:
    def test_a_completed_series_is_certain(self):
        assert conditional_series_probability(4, 0, 0.6, 0.5) == 1.0
        assert conditional_series_probability(0, 4, 0.6, 0.5) == 0.0

    def test_a_fresh_series_matches_the_unconditional_number(self):
        assert conditional_series_probability(0, 0, 0.65, 0.55) == pytest.approx(
            series_probability(0.65, 0.55)
        )

    def test_leading_helps(self):
        ahead = conditional_series_probability(2, 1, 0.65, 0.55)
        behind = conditional_series_probability(1, 2, 0.65, 0.55)
        assert ahead > behind

    def test_3_0_is_nearly_decided(self):
        assert conditional_series_probability(3, 0, 0.65, 0.55) > 0.95

    def test_remaining_games_keep_their_real_venues(self):
        """Not a fresh best-of-four: the games left carry their own slots.

        At 2-2 the higher seed hosts games 5 and 7 but not 6, which is a
        different question from 'win two of three at neutral venues'.
        """
        tied = conditional_series_probability(2, 2, 0.72, 0.55)
        # Hosting two of the last three is worth more than a coin flip for
        # a side that is better anyway.
        assert 0.5 < tied < 1.0


class TestHomePattern:
    def test_the_higher_seed_hosts_four_of_seven(self):
        assert sum(HOME_PATTERN_2_2_1_1_1) == 4
        assert sum(HOME_PATTERN_2_3_2) == 4

    def test_finals_used_2_3_2_before_2014(self):
        assert pattern_for(2010, 0) == HOME_PATTERN_2_3_2
        assert pattern_for(2020, 0) == HOME_PATTERN_2_2_1_1_1
        assert FINALS_PATTERN_CHANGED_SEASON == 2014

    def test_every_other_round_has_always_been_2_2_1_1_1(self):
        for depth in (1, 2, 3):
            assert pattern_for(2010, depth) == HOME_PATTERN_2_2_1_1_1


class TestBuildSeries:
    def test_reconstructs_a_sweep(self):
        games = [
            _game(f"g{i}", f"2024-04-2{i}T00:00:00+00:00",
                  1 if i < 2 else 2, 2 if i < 2 else 1,
                  110 if i < 2 else 100, 100 if i < 2 else 110, "2024:1v2")
            for i in range(4)
        ]
        series = build_series(games)
        assert len(series) == 1
        assert series[0].wins_a == 4
        assert series[0].winner_id == 1
        assert series[0].completed

    def test_an_unfinished_series_has_no_winner(self):
        games = [
            _game("g0", "2024-04-20T00:00:00+00:00", 1, 2, 110, 100, "2024:1v2"),
            _game("g1", "2024-04-22T00:00:00+00:00", 1, 2, 100, 110, "2024:1v2"),
        ]
        series = build_series(games)
        assert series[0].winner_id is None
        assert not series[0].completed
        assert series[0].games_played == 2

    def test_team_a_is_the_game_one_host(self):
        """Orientation is stored rather than re-derived from a round name.

        Under every NBA format the higher seed hosts game 1, so this is the
        seeding information the model needs and it comes from the schedule
        rather than from ESPN's inconsistent round vocabulary.
        """
        games = [_game("g0", "2024-04-20T00:00:00+00:00", 7, 3, 110, 100, "2024:3v7")]
        assert build_series(games)[0].team_a_id == 7

    def test_games_without_a_series_id_are_ignored(self):
        games = [_game("g0", "2024-04-20T00:00:00+00:00", 1, 2, 110, 100, None)]
        assert build_series(games) == []


class TestAssignDepth:
    def test_depth_is_counted_not_parsed(self):
        """Round names are inconsistent across seasons; wave SIZE is not.

        Eight simultaneous series is a first round whatever ESPN calls it,
        and one series in June is a final.
        """
        games = []
        # 8 first-round series starting together
        for s in range(8):
            games.append(
                _game(f"r1-{s}", "2024-04-20T00:00:00+00:00", s * 2 + 1, s * 2 + 2,
                      110, 100, f"2024:{s * 2 + 1}v{s * 2 + 2}", phase="Rd 1")
            )
        # 1 final, weeks later
        games.append(
            _game("f0", "2024-06-06T00:00:00+00:00", 1, 3, 110, 100,
                  "2024:1v3", phase="Championship")
        )
        series = build_series(games)
        assign_depth(series)
        by_id = {s.series_id: s for s in series}
        assert by_id["2024:1v2"].depth == 3
        assert by_id["2024:1v3"].depth == 0

    def test_an_unexpected_wave_size_is_left_unset(self):
        """A malformed season must be visible, not silently misplaced."""
        games = [
            _game(f"x{s}", "2024-04-20T00:00:00+00:00", s * 2 + 1, s * 2 + 2,
                  110, 100, f"2024:{s * 2 + 1}v{s * 2 + 2}")
            for s in range(3)
        ]
        series = build_series(games)
        assign_depth(series)
        assert all(s.depth is None for s in series)
