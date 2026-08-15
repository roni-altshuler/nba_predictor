"""The projected bracket and the title-race trajectory."""

from __future__ import annotations

import json

import pytest

from backend.scripts.build_history import build_context, seasons_lost
from backend.scripts.title_race import _checkpoint_dates, _eastern_day
from backend.services.playoffs.projection import (
    FIRST_ROUND_PAIRS,
    _modal_length,
    assign_projected_seeds,
    project_first_round,
)
from backend.services.simulation.season_simulator import SeasonSimulator


def _team(team_id, name, wins, distribution):
    return {
        "team_id": team_id,
        "name": name,
        "abbreviation": name[:3].upper(),
        "logo": None,
        "wins": wins,
        "losses": 82 - wins,
        "seed_distribution": {str(k): v for k, v in distribution.items()},
    }


class TestSeedAssignment:
    def test_every_seed_gets_a_different_team(self):
        """The bug this guards is a bracket with one team in two slots.

        Greedy assignment without the `used` set happily gives the same
        franchise seeds 1 and 2 whenever it is the favourite for both, and
        the resulting bracket draws it playing itself.
        """
        teams = [
            _team(i, f"team{i}", 60 - i, {1: 0.9 - i * 0.1, 2: 0.5, 3: 0.4})
            for i in range(1, 11)
        ]
        seeds = assign_projected_seeds(teams)
        assert len(seeds) == 8
        assert [s["seed"] for s in seeds] == list(range(1, 9))
        placed = [s["team"]["team_id"] for s in seeds]
        assert len(set(placed)) == 8

    def test_the_most_confident_claim_is_honoured_first(self):
        teams = [
            _team(1, "alpha", 50, {1: 0.30, 2: 0.25}),
            _team(2, "bravo", 55, {1: 0.62, 2: 0.20}),
            _team(3, "charlie", 45, {1: 0.05, 2: 0.40}),
        ]
        seeds = assign_projected_seeds(teams, slots=3)
        assert seeds[0]["team"]["team_id"] == 2
        assert seeds[0]["p_seed"] == pytest.approx(0.62)

    def test_an_unclaimed_seed_falls_back_to_the_best_remaining_record(self):
        """A seed nobody claims is filled, and its p_seed reports the truth.

        Left blank it would read as certainty; filled with a fabricated
        probability it would read as evidence. The real number here is zero
        and the page prints zero.
        """
        teams = [
            _team(1, "alpha", 50, {1: 0.9}),
            _team(2, "bravo", 48, {}),
            _team(3, "charlie", 30, {}),
        ]
        seeds = assign_projected_seeds(teams, slots=3)
        by_seed = {s["seed"]: s for s in seeds}
        assert by_seed[2]["team"]["team_id"] == 2  # better record fills first
        assert by_seed[2]["p_seed"] == 0.0
        assert by_seed[3]["team"]["team_id"] == 3

    def test_it_does_not_invent_teams_it_was_not_given(self):
        teams = [_team(1, "alpha", 50, {1: 0.9}), _team(2, "bravo", 40, {2: 0.5})]
        seeds = assign_projected_seeds(teams)
        assert len(seeds) == 2


class TestFirstRound:
    def _seeds(self):
        teams = [
            _team(i, f"team{i}", 60 - 2 * i, {i: 0.5}) for i in range(1, 9)
        ]
        return assign_projected_seeds(teams)

    def _elo(self):
        return {i: 1600 - 20 * i for i in range(1, 9)}

    def test_it_pairs_the_bracket_so_one_and_two_cannot_meet_early(self):
        """1/8, 4/5, 3/6, 2/7 — the order that keeps 1 and 2 apart.

        Pairing 1-8, 2-7, 3-6, 4-5 in bracket order instead puts the top two
        seeds in the same half, and they meet in the semi-finals rather than
        the conference finals. The league's draw does not work that way.
        """
        assert FIRST_ROUND_PAIRS == ((1, 8), (4, 5), (3, 6), (2, 7))
        simulator = SeasonSimulator(simulations=1)
        series = project_first_round(
            self._seeds(),
            game_probability=simulator.game_probability,
            elo=self._elo(),
        )
        assert [(s["high_seed"], s["low_seed"]) for s in series] == [
            (1, 8), (4, 5), (3, 6), (2, 7),
        ]

    def test_home_and_away_game_probabilities_differ(self):
        """The reason a series is not a binomial.

        One number for "how often does the better team win a game" throws
        away home court, which is four games of seven for the higher seed.
        """
        simulator = SeasonSimulator(simulations=1)
        series = project_first_round(
            self._seeds(),
            game_probability=simulator.game_probability,
            elo=self._elo(),
        )
        for item in series:
            assert item["p_high_game_home"] > item["p_high_game_away"]

    def test_the_series_is_more_certain_than_a_single_game(self):
        simulator = SeasonSimulator(simulations=1)
        series = project_first_round(
            self._seeds(),
            game_probability=simulator.game_probability,
            elo=self._elo(),
        )
        one_v_eight = series[0]
        assert one_v_eight["p_high_series"] > one_v_eight["p_high_game_home"]

    def test_both_sides_of_a_series_sum_to_one(self):
        simulator = SeasonSimulator(simulations=1)
        for item in project_first_round(
            self._seeds(),
            game_probability=simulator.game_probability,
            elo=self._elo(),
        ):
            assert item["p_high_series"] + item["p_low_series"] == pytest.approx(
                1.0, abs=1e-4
            )

    def test_a_team_with_no_rating_is_skipped_not_guessed(self):
        simulator = SeasonSimulator(simulations=1)
        elo = self._elo()
        del elo[8]
        series = project_first_round(
            self._seeds(), game_probability=simulator.game_probability, elo=elo
        )
        assert [(s["high_seed"], s["low_seed"]) for s in series] == [
            (4, 5), (3, 6), (2, 7),
        ]


class TestModalLength:
    def test_it_sums_both_winners_at_the_same_length(self):
        lengths = {
            "higher_in_6": 0.20, "lower_in_6": 0.19,
            "higher_in_7": 0.30, "lower_in_7": 0.05,
        }
        # 6 games: .39 across both winners; 7 games: .35. Reading only the
        # higher seed's column would answer 7.
        assert _modal_length(lengths) == 6

    def test_no_lengths_is_none_rather_than_zero(self):
        assert _modal_length({}) is None


class TestRoundReachMonotonicity:
    def test_surviving_a_round_is_never_more_likely_than_reaching_it(self):
        """Each round's probability bounds the next one.

        A violation means the survivor counters are counting entrants
        somewhere, and the bracket page would print a team more likely to
        make the Finals than the second round.
        """
        simulator = SeasonSimulator(simulations=200)
        teams = {
            i: {
                "name": f"team{i}",
                "conference": "Eastern Conference" if i < 15 else "Western Conference",
                "elo": 1400 + 12 * i,
            }
            for i in range(30)
        }
        remaining = [
            (i, j) for i in range(30) for j in range(30) if i != j and (i + j) % 7 == 0
        ]
        result = simulator.simulate(
            season=2027,
            teams=teams,
            standings={},
            remaining=remaining,
            generated_at="x",
        )
        for team in result.teams:
            assert team.p_playoffs >= team.p_conf_semis - 1e-9
            assert team.p_conf_semis >= team.p_conf_finals - 1e-9
            assert team.p_conf_finals >= team.p_conference_title - 1e-9
            assert team.p_conference_title >= team.p_championship - 1e-9


class TestFixtureContext:
    """The series history and form a fixture page shows before tip-off."""

    def _rows(self):
        def row(gid, date, home, away, hs, as_, season=2026, stype=2, phase=None):
            return {
                "game_id": gid, "date_utc": date, "season": season,
                "season_type": stype, "home_team_id": home, "away_team_id": away,
                "home_score": hs, "away_score": as_, "phase": phase,
            }

        # Chronological, as Warehouse.iter_games guarantees.
        return [
            row("1", "2025-11-01T00:00:00+00:00", 1, 2, 100, 90),
            row("2", "2025-12-01T00:00:00+00:00", 2, 1, 110, 95),
            row("3", "2026-01-01T00:00:00+00:00", 1, 2, 105, 108),
            row("4", "2026-02-01T00:00:00+00:00", 1, 2, 99, 88,
                phase="NBA Cup Championship"),
            row("5", "2026-05-01T00:00:00+00:00", 1, 2, 101, 97, stype=3),
        ]

    def _franchises(self):
        return {
            1: {"abbreviation": "AAA", "display_name": "Team A"},
            2: {"abbreviation": "BBB", "display_name": "Team B"},
        }

    def test_head_to_head_is_keyed_on_the_sorted_pair(self):
        """A lookup must not have to know which side is at home."""
        out = build_context(self._rows(), self._franchises())
        assert set(out["head_to_head"]) == {"AAA|BBB"}
        assert len(out["head_to_head"]["AAA|BBB"]) == 5

    def test_meetings_stay_in_chronological_order(self):
        # The last N entries ARE the most recent N — there is no sort here to
        # get subtly wrong, which is only true if order is preserved.
        out = build_context(self._rows(), self._franchises())
        dates = [m["date"] for m in out["head_to_head"]["AAA|BBB"]]
        assert dates == sorted(dates)

    def test_form_records_both_sides_of_every_game(self):
        out = build_context(self._rows(), self._franchises())
        assert len(out["form"]["AAA"]) == 5
        assert len(out["form"]["BBB"]) == 5
        first = out["form"]["AAA"][0]
        assert first["opponent"] == "BBB"
        assert first["home"] is True
        assert first["won"] is True
        assert out["form"]["BBB"][0]["won"] is False

    def test_the_record_excludes_the_cup_final_and_the_postseason(self):
        """Two different exclusions, both real.

        ESPN files the NBA Cup Championship as a regular-season game and the
        league does not count it; including it put New York on 83 games and
        54-29 against 53-29 on the standings page. The postseason is a
        different population and folding it in flatters everyone who made it.
        """
        out = build_context(self._rows(), self._franchises())
        # Three regular-season meetings count: AAA wins one and loses two.
        # Counting the Cup final and the playoff game as well would read
        # 3-2, and both of those extra wins belong to AAA — exactly the
        # direction that flatters a team.
        assert out["records"]["AAA"] == {"season": 2026, "wins": 1, "losses": 2}
        assert out["records"]["BBB"] == {"season": 2026, "wins": 2, "losses": 1}

    def test_a_new_season_resets_the_record_rather_than_accumulating(self):
        rows = [
            {"game_id": "a", "date_utc": "2025-11-01T00:00:00+00:00", "season": 2025,
             "season_type": 2, "home_team_id": 1, "away_team_id": 2,
             "home_score": 100, "away_score": 90, "phase": None},
            {"game_id": "b", "date_utc": "2026-11-01T00:00:00+00:00", "season": 2026,
             "season_type": 2, "home_team_id": 1, "away_team_id": 2,
             "home_score": 100, "away_score": 90, "phase": None},
        ]
        out = build_context(rows, self._franchises())
        assert out["records"]["AAA"] == {"season": 2026, "wins": 1, "losses": 0}

    def test_it_keeps_only_the_published_depth(self):
        rows = [
            {"game_id": str(i), "date_utc": f"2026-01-{i:02d}T00:00:00+00:00",
             "season": 2026, "season_type": 2, "home_team_id": 1,
             "away_team_id": 2, "home_score": 100 + i, "away_score": 90,
             "phase": None}
            for i in range(1, 21)
        ]
        out = build_context(rows, self._franchises())
        assert len(out["head_to_head"]["AAA|BBB"]) == out["h2h_depth"]
        assert len(out["form"]["AAA"]) == out["form_depth"]
        # The kept ones are the LATEST, not the first.
        assert out["head_to_head"]["AAA|BBB"][-1]["id"] == "20"


class TestArchiveIndexGuard:
    """`--from-season` must never shrink the archive index.

    The bug this guards shipped: the flag filtered the index as well as the
    files, so a daily `--from-season <current>` run cut `seasons.json` to one
    season and `game_index.json` to 1,322 of 29,653 games — turning every
    other archived game URL into a 404 while 22 perfectly good season files
    sat on disk beside it. Nothing failed; the pages simply stopped existing.
    """

    def test_it_names_the_seasons_that_would_disappear(self, tmp_path):
        path = tmp_path / "seasons.json"
        path.write_text(json.dumps({"seasons": [{"season": s} for s in range(2004, 2027)]}))
        assert seasons_lost(path, {2026}) == list(range(2004, 2026))

    def test_a_complete_republish_loses_nothing(self, tmp_path):
        path = tmp_path / "seasons.json"
        path.write_text(json.dumps({"seasons": [{"season": s} for s in (2025, 2026)]}))
        assert seasons_lost(path, {2025, 2026, 2027}) == []

    def test_a_first_run_with_no_live_index_is_not_a_loss(self, tmp_path):
        assert seasons_lost(tmp_path / "absent.json", {2026}) == []

    def test_an_unreadable_index_does_not_block_a_republish(self, tmp_path):
        # A corrupt file is a reason to rewrite it, not a reason to refuse.
        path = tmp_path / "seasons.json"
        path.write_text("{ truncated")
        assert seasons_lost(path, {2026}) == []


class TestTitleRaceHelpers:
    def test_a_late_tip_off_belongs_to_the_eastern_day_it_was_played(self):
        """A 10:30pm Pacific tip-off is the same evening's game.

        Bucketing on UTC moves it to the next date, which is how phantom
        back-to-backs got into the integrity check the first time round.
        """
        assert _eastern_day("2026-01-16T03:30:00+00:00") == "2026-01-15"
        assert _eastern_day("2026-01-15T23:00:00+00:00") == "2026-01-15"

    def test_checkpoints_span_the_season_and_include_the_last_day(self):
        dates = _checkpoint_dates(
            "2025-10-21T23:00:00+00:00", "2026-04-13T23:00:00+00:00", 10
        )
        assert dates[0] == "2025-10-21"
        assert dates[-1] == "2026-04-13"
        assert dates == sorted(dates)
        assert len(set(dates)) == len(dates)

    def test_a_final_day_that_already_lands_on_a_step_is_not_duplicated(self):
        dates = _checkpoint_dates(
            "2025-10-21T23:00:00+00:00", "2025-10-31T23:00:00+00:00", 10
        )
        assert dates == ["2025-10-21", "2025-10-31"]
