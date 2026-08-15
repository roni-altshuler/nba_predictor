"""The warehouse and the ESPN loader.

Every test here corresponds to a real payload ESPN served during this
project's build, and to a specific way that payload could corrupt the corpus.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.services.data.espn_loader import ESPNLoader, is_placeholder
from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    GameRow,
    ScheduledGameRow,
    Warehouse,
)
from backend.services.espn.client import current_season, season_bounds


@pytest.fixture()
def warehouse(tmp_path) -> Warehouse:
    wh = Warehouse(tmp_path / "test.sqlite")
    wh.migrate()
    return wh


def _event(
    event_id="1",
    date="2026-01-15T00:30Z",
    home=("1", "Atlanta Hawks", 110),
    away=("2", "Boston Celtics", 100),
    state="post",
    status_name="STATUS_FINAL",
    completed=True,
    season_year=2026,
    season_type=2,
    notes=None,
    odds=None,
):
    return {
        "id": event_id,
        "date": date,
        "season": {"year": season_year, "type": season_type},
        "status": {
            "type": {
                "state": state,
                "name": status_name,
                "completed": completed,
                "description": "Final",
            }
        },
        "competitions": [
            {
                "neutralSite": False,
                "venue": {"fullName": "State Farm Arena"},
                "notes": notes or [],
                "odds": odds or [],
                "competitors": [
                    {
                        "homeAway": "home",
                        "score": home[2],
                        "team": {"id": home[0], "displayName": home[1],
                                 "abbreviation": "ATL"},
                        "linescores": [
                            {"period": 1, "value": 28}, {"period": 2, "value": 27},
                            {"period": 3, "value": 25}, {"period": 4, "value": 30},
                        ],
                    },
                    {
                        "homeAway": "away",
                        "score": away[2],
                        "team": {"id": away[0], "displayName": away[1],
                                 "abbreviation": "BOS"},
                        "linescores": [
                            {"period": 1, "value": 25}, {"period": 2, "value": 25},
                            {"period": 3, "value": 25}, {"period": 4, "value": 25},
                        ],
                    },
                ],
            }
        ],
    }


class TestSchema:
    def test_migrate_is_idempotent(self, warehouse):
        assert warehouse.migrate() == warehouse.migrate()

    def test_counts_starts_empty(self, warehouse):
        counts = warehouse.counts()
        assert counts["games"] == 0
        assert counts["teams"] == 0


class TestTeamIdentity:
    def test_espn_id_is_the_key_not_the_name(self, warehouse):
        """The single biggest simplification over the soccer warehouse.

        A franchise that relocates keeps its ESPN id — Seattle SuperSonics
        and Oklahoma City Thunder are both id 25 — so a rename must update
        the display name in place rather than creating a second row.
        """
        first = warehouse.upsert_team("25", "Seattle SuperSonics")
        second = warehouse.upsert_team("25", "Oklahoma City Thunder")
        assert first == second
        assert len(warehouse.teams()) == 1

    def test_upsert_does_not_blank_existing_fields(self, warehouse):
        """A scoreboard row carries a short name and no conference. It must
        not erase the conference a standings pull established."""
        team_id = warehouse.upsert_team(
            "1", "Atlanta Hawks", conference="Eastern Conference"
        )
        warehouse.upsert_team("1", "Atlanta Hawks", abbreviation="ATL")
        row = warehouse.conn.execute(
            "SELECT * FROM teams WHERE team_id = ?", (team_id,)
        ).fetchone()
        assert row["conference"] == "Eastern Conference"
        assert row["abbreviation"] == "ATL"

    def test_alias_lookup_is_exact_after_normalisation(self, warehouse):
        team_id = warehouse.upsert_team("1", "Atlanta Hawks")
        assert warehouse.team_id_for_name("atlanta hawks") == team_id
        assert warehouse.team_id_for_name("ATLANTA  HAWKS") == team_id

    def test_teams_sharing_a_city_do_not_collide(self, warehouse):
        """`Los Angeles Lakers` and `Los Angeles Clippers` share a city.

        The normaliser deliberately does NOT strip city or nickname tokens,
        because doing so would fuse the two.
        """
        lakers = warehouse.upsert_team("13", "Los Angeles Lakers")
        clippers = warehouse.upsert_team("12", "LA Clippers")
        assert lakers != clippers
        assert warehouse.team_id_for_name("Los Angeles Lakers") == lakers


class TestGameWrites:
    def test_upsert_then_read_back(self, warehouse):
        home = warehouse.upsert_team("1", "Atlanta Hawks")
        away = warehouse.upsert_team("2", "Boston Celtics")
        warehouse.upsert_competition("nba", "NBA")
        warehouse.upsert_games([
            GameRow("g1", "espn", "nba", 2026, SEASON_TYPE_REGULAR,
                    "2026-01-15T00:30:00+00:00", home, away, 110, 100)
        ])
        rows = list(warehouse.iter_games())
        assert len(rows) == 1
        assert rows[0]["home_score"] == 110

    def test_a_second_pass_does_not_blank_the_box_score(self, warehouse):
        """A scoreboard pass carries no box score. It must not erase the one
        a summary pass wrote."""
        home = warehouse.upsert_team("1", "A")
        away = warehouse.upsert_team("2", "B")
        warehouse.upsert_competition("nba", "NBA")
        warehouse.upsert_games([
            GameRow("g1", "espn", "nba", 2026, 2, "2026-01-15T00:30:00+00:00",
                    home, away, 110, 100, extra={"home_fga": 88.0})
        ])
        warehouse.upsert_games([
            GameRow("g1", "espn", "nba", 2026, 2, "2026-01-15T00:30:00+00:00",
                    home, away, 112, 100)
        ])
        row = list(warehouse.iter_games())[0]
        assert row["home_fga"] == 88.0   # preserved
        assert row["home_score"] == 112  # corrected

    def test_unknown_column_is_refused(self, warehouse):
        """A typo in a loader is a bug, not a column to invent."""
        with pytest.raises(KeyError):
            GameRow("g", "espn", "nba", 2026, 2, "2026-01-15T00:30:00+00:00",
                    1, 2, 110, 100, extra={"hom_fga": 1.0}).as_params()

    def test_iter_games_is_chronological(self, warehouse):
        home = warehouse.upsert_team("1", "A")
        away = warehouse.upsert_team("2", "B")
        warehouse.upsert_competition("nba", "NBA")
        warehouse.upsert_games([
            GameRow("g2", "espn", "nba", 2026, 2, "2026-02-01T00:30:00+00:00",
                    home, away, 110, 100),
            GameRow("g1", "espn", "nba", 2026, 2, "2026-01-01T00:30:00+00:00",
                    home, away, 110, 100),
        ])
        dates = [r["date_utc"] for r in warehouse.iter_games()]
        assert dates == sorted(dates)


class TestScheduledDisjoint:
    def test_a_played_game_leaves_the_schedule(self, warehouse):
        """A game in both tables is simulated twice and never clears."""
        home = warehouse.upsert_team("1", "A")
        away = warehouse.upsert_team("2", "B")
        warehouse.upsert_competition("nba", "NBA")
        warehouse.upsert_scheduled([
            ScheduledGameRow("g1", "espn", "nba", 2027, 2,
                             "2026-10-20T23:00:00+00:00", home, away)
        ])
        warehouse.upsert_games([
            GameRow("g1", "espn", "nba", 2027, 2, "2026-10-20T23:00:00+00:00",
                    home, away, 110, 100)
        ])
        assert warehouse.prune_played_from_scheduled() == 1
        assert list(warehouse.iter_scheduled()) == []


class TestEloReads:
    def test_latest_elo_is_strictly_earlier(self, warehouse):
        """Ratings are POST-game values stamped at tip-off, so `<` rather
        than `<=` is what makes a feature point-in-time correct. Using `<=`
        leaks the result of the game being predicted."""
        team = warehouse.upsert_team("1", "A")
        warehouse.write_elo([
            (team, "2026-01-01T00:00:00+00:00", 1500.0),
            (team, "2026-01-05T00:00:00+00:00", 1550.0),
        ])
        assert warehouse.latest_elo(team, "2026-01-05T00:00:00+00:00") == 1500.0
        assert warehouse.latest_elo(team) == 1550.0


class TestPlaceholders:
    def test_recognises_espn_bracket_slots(self):
        for name in ("TBD", "tba", "Winner of Game 3", "Group A 2nd Place",
                     "Seed 4", "1st Place"):
            assert is_placeholder(name), name

    def test_accepts_real_franchises(self):
        for name in ("Atlanta Hawks", "LA Clippers", "Oklahoma City Thunder",
                     "Portland Trail Blazers", "76ers", "Philadelphia 76ers"):
            assert not is_placeholder(name), name

    def test_empty_is_a_placeholder(self):
        assert is_placeholder(None)
        assert is_placeholder("")


class TestLoaderParsing:
    def test_parses_a_final(self, warehouse):
        loader = ESPNLoader(warehouse)
        game, scheduled = loader.parse_event(_event())
        assert scheduled is None
        assert game is not None
        assert game.home_score == 110 and game.away_score == 100
        assert game.extra["home_q1"] == 28

    def test_an_upcoming_game_is_scheduled_not_a_result(self, warehouse):
        loader = ESPNLoader(warehouse)
        game, scheduled = loader.parse_event(
            _event(state="pre", status_name="STATUS_SCHEDULED", completed=False,
                   home=("1", "Atlanta Hawks", None), away=("2", "Boston Celtics", None))
        )
        assert game is None and scheduled is not None

    def test_a_postponed_game_is_neither(self, warehouse):
        """ESPN keeps the original event forever with STATUS_POSTPONED and
        publishes the makeup under a NEW id. Filing the original as
        'scheduled' leaves a game in the remaining set that will never be
        played — the 2025-26 season ended with four such rows."""
        loader = ESPNLoader(warehouse)
        game, scheduled = loader.parse_event(
            _event(state="post", status_name="STATUS_POSTPONED", completed=True,
                   home=("1", "A", 0), away=("2", "B", 0))
        )
        assert game is None and scheduled is None

    def test_a_zero_zero_final_is_refused(self, warehouse):
        """No NBA game has ever finished 0-0."""
        loader = ESPNLoader(warehouse)
        game, scheduled = loader.parse_event(
            _event(home=("1", "A", 0), away=("2", "B", 0))
        )
        assert game is None and scheduled is None

    def test_both_sides_the_same_team_is_refused(self, warehouse):
        loader = ESPNLoader(warehouse)
        game, scheduled = loader.parse_event(
            _event(home=("1", "A", 110), away=("1", "A", 100))
        )
        assert game is None and scheduled is None

    def test_a_placeholder_side_is_refused(self, warehouse):
        """A junk `teams` row is permanent and competes with every later
        lookup, so the refusal is at the ingester."""
        loader = ESPNLoader(warehouse)
        game, scheduled = loader.parse_event(
            _event(state="pre", status_name="STATUS_SCHEDULED", completed=False,
                   home=("99", "TBD", None), away=("98", "TBD", None))
        )
        assert game is None and scheduled is None
        assert warehouse.counts()["teams"] == 0

    def test_play_in_is_split_out_of_the_postseason(self, warehouse):
        """A play-in game is a one-off, not a best-of-seven, and must never
        train the series model."""
        loader = ESPNLoader(warehouse)
        game, _ = loader.parse_event(
            _event(season_type=3, notes=[{"headline": "Play-In Tournament"}])
        )
        assert game.season_type == SEASON_TYPE_PLAY_IN

    def test_a_real_playoff_game_keeps_its_type(self, warehouse):
        loader = ESPNLoader(warehouse)
        game, _ = loader.parse_event(
            _event(season_type=3, notes=[{"headline": "NBA Finals - Game 1"}])
        )
        assert game.season_type == SEASON_TYPE_POSTSEASON

    def test_odds_are_extracted(self, warehouse):
        loader = ESPNLoader(warehouse)
        game, _ = loader.parse_event(_event(odds=[{
            "provider": {"name": "DraftKings"},
            "spread": -5.5,
            "overUnder": 220.5,
            "homeTeamOdds": {"moneyLine": -218, "favorite": True},
            "awayTeamOdds": {"moneyLine": 180, "favorite": False},
        }]))
        assert game.extra["ml_home"] == -218
        assert game.extra["total_points"] == 220.5


class TestSeasonConvention:
    def test_the_rollover_is_july_not_september(self):
        """From July the season carrying that label is finished, so the only
        season worth forecasting is the next one. A September rollover
        publishes projections for a season already decided."""
        assert current_season(datetime(2026, 8, 15, tzinfo=timezone.utc)) == 2027
        assert current_season(datetime(2026, 6, 1, tzinfo=timezone.utc)) == 2026
        assert current_season(datetime(2026, 12, 1, tzinfo=timezone.utc)) == 2027
        assert current_season(datetime(2027, 3, 1, tzinfo=timezone.utc)) == 2027

    def test_season_bounds_are_wider_than_the_rollover(self):
        """The two answer different questions and must not be collapsed:
        bounds must catch October preseason and a July Finals."""
        start, end = season_bounds(2026)
        assert start.year == 2025 and start.month == 9
        assert end.year == 2026

    def test_the_2020_bubble_window_is_extended(self):
        """That season restarted in July and finished in October."""
        _, end = season_bounds(2020)
        assert end.month == 10
