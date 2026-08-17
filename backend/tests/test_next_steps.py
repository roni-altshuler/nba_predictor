"""Arenas, the injury log, the rehearsal invariants and the live win model.

Grouped because they were built together and share one theme: each is a
guard against a failure that cannot be undone after the fact. A day of
injuries not recorded, a season opening on untested code, a model shipped
because nobody measured it.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from backend.scripts import rehearse, track_injuries
from backend.scripts.build_history import build_comebacks
from backend.services.data.arenas import (
    ARENAS,
    NO_DST,
    altitude_delta,
    arena_for,
    distance_between,
    haversine_km,
    timezone_shift,
)
from backend.services.prediction.feature_builder import FEATURE_NAMES, geography
from backend.services.prediction.live_winprob import (
    REGULATION_SECONDS,
    LiveWinProbModel,
    fraction_left,
    tied_game_baseline,
)


# ------------------------------------------------------------------ arenas


def test_every_franchise_has_an_arena():
    assert len(ARENAS) == 30


def test_denver_and_utah_are_the_only_arenas_above_a_kilometre():
    """The entire altitude story, asserted rather than assumed.

    If a franchise relocates somewhere high this test fails, which is the
    correct amount of noise for a fact the model's documentation leans on.
    """
    high = sorted(a.abbreviation for a in ARENAS.values() if a.altitude_m > 1000)
    assert high == ["DEN", "UTAH"]


def test_no_arena_is_at_a_nonsense_coordinate():
    for arena in ARENAS.values():
        assert 25.0 <= arena.latitude <= 50.0, arena.abbreviation
        assert -125.0 <= arena.longitude <= -70.0, arena.abbreviation
        assert 0.0 <= arena.altitude_m <= 2000.0, arena.abbreviation


def test_phoenix_is_recorded_as_the_daylight_saving_exception():
    assert NO_DST == {"PHX"}


def test_distance_is_symmetric_and_zero_to_itself():
    assert distance_between("BOS", "BOS") == pytest.approx(0.0, abs=1e-9)
    assert distance_between("BOS", "LAL") == pytest.approx(
        distance_between("LAL", "BOS")
    )


def test_known_distances_are_right():
    # Boston to Los Angeles is about 4,170 km great-circle.
    assert distance_between("BOS", "LAL") == pytest.approx(4172, abs=40)
    # The two New York arenas are a few kilometres apart.
    assert distance_between("NY", "BKN") < 15


def test_haversine_handles_the_antipode_without_a_domain_error():
    """`asin` of anything above 1 is a crash; floating point gets there."""
    assert haversine_km((0.0, 0.0), (0.0, 180.0)) == pytest.approx(
        math.pi * 6371.0088, rel=1e-6
    )


def test_altitude_delta_is_signed_from_the_visitor_perspective():
    assert altitude_delta("DEN", "MIA") == pytest.approx(1608, abs=5)
    assert altitude_delta("MIA", "DEN") == pytest.approx(-1608, abs=5)


def test_timezone_shift_is_positive_going_east():
    """Eastward costs an hour of sleep; the sign carries that asymmetry."""
    assert timezone_shift("LAL", "BOS") == 3
    assert timezone_shift("BOS", "LAL") == -3


def test_an_unknown_franchise_is_none_rather_than_a_raise():
    assert arena_for(None) is None
    assert arena_for("ZZZ") is None
    assert distance_between("ZZZ", "BOS") is None
    assert altitude_delta("BOS", None) is None


def test_abbreviation_lookup_is_case_and_space_insensitive():
    assert arena_for(" bos ") is ARENAS["BOS"]


# -------------------------------------------------------------- geography


def test_geography_is_not_in_the_served_vector():
    """It was built, measured and deliberately not added.

    The ablation put every part of the block inside the noise floor, and this
    project's rule is that a constant feature is not free. The test exists so
    that adding it back is a decision somebody makes on purpose.
    """
    for name in ("travel_km_home", "travel_km_away", "altitude_delta_away",
                 "tz_shift_away"):
        assert name not in FEATURE_NAMES
    assert len(FEATURE_NAMES) == 19


def test_geography_still_computes_for_the_record():
    out = geography(
        venue="DEN", home_last_venue="DEN", away_last_venue="LAL",
        away_home="MIA", neutral=False,
    )
    assert len(out) == 4
    assert out[0] == pytest.approx(0.0)      # home team was already home
    assert out[1] > 1.0                       # LA to Denver, thousands of km
    assert out[2] == pytest.approx(1.608, abs=0.01)
    assert out[3] == pytest.approx(-2.0)      # Miami to Denver is westward


def test_a_neutral_site_zeroes_the_whole_block():
    """The one place a zero means unknown, quarantined behind one flag."""
    assert geography(
        venue="DEN", home_last_venue="LAL", away_last_venue="BOS",
        away_home="BOS", neutral=True,
    ) == [0.0, 0.0, 0.0, 0.0]


def test_a_first_ever_game_reads_as_no_travel_rather_than_crashing():
    out = geography(
        venue="BOS", home_last_venue=None, away_last_venue=None,
        away_home="LAL", neutral=False,
    )
    assert out[0] == 0.0 and out[1] == 0.0
    assert out[2] != 0.0  # altitude is still known: it needs no history


# ----------------------------------------------------------- injury log


def _entry(team, player, status, detail=None, return_date=None):
    return {
        "team": team, "player": player, "position": "G",
        "status": status, "detail": detail, "return_date": return_date,
        "espn_date": "2026-08-01T00:00Z",
    }


def test_a_new_player_on_the_report_is_a_row():
    rows = track_injuries.diff(
        {("BOS", "A"): _entry("BOS", "A", "Out")}, {}, "2026-08-17T00:00:00+00:00"
    )
    assert [(r["player"], r["status"]) for r in rows] == [("A", "Out")]


def test_an_unchanged_player_writes_nothing():
    """The whole reason this is a transition log and not a daily snapshot."""
    current = {("BOS", "A"): _entry("BOS", "A", "Out", "Knee")}
    previous = {("BOS", "A"): {**_entry("BOS", "A", "Out", "Knee"),
                               "observed_at": "2026-08-16T00:00:00+00:00"}}
    assert track_injuries.diff(current, previous, "2026-08-17T00:00:00+00:00") == []


def test_a_restamped_espn_date_alone_does_not_write_a_row():
    """ESPN restamps a report it re-publishes unchanged.

    Including `espn_date` in the comparison would append a row every morning
    for a player whose situation has not moved, which is exactly the cost
    this format exists to avoid.
    """
    current = {("BOS", "A"): {**_entry("BOS", "A", "Out"), "espn_date": "2026-08-17T09:00Z"}}
    previous = {("BOS", "A"): {**_entry("BOS", "A", "Out"),
                               "espn_date": "2026-08-16T09:00Z",
                               "observed_at": "2026-08-16T00:00:00+00:00"}}
    assert track_injuries.diff(current, previous, "2026-08-17T00:00:00+00:00") == []


def test_a_changed_status_is_a_row():
    current = {("BOS", "A"): _entry("BOS", "A", "Questionable")}
    previous = {("BOS", "A"): {**_entry("BOS", "A", "Out"),
                               "observed_at": "2026-08-16T00:00:00+00:00"}}
    rows = track_injuries.diff(current, previous, "2026-08-17T00:00:00+00:00")
    assert [r["status"] for r in rows] == ["Questionable"]


def test_dropping_off_the_report_is_recorded_as_available():
    """Otherwise the log can say a player was Out and never say he returned."""
    previous = {("BOS", "A"): {**_entry("BOS", "A", "Out"),
                               "observed_at": "2026-08-16T00:00:00+00:00"}}
    rows = track_injuries.diff({}, previous, "2026-08-17T00:00:00+00:00")
    assert [(r["player"], r["status"]) for r in rows] == [("A", "Available")]


def test_a_player_already_marked_available_is_not_re_cleared():
    previous = {("BOS", "A"): {**_entry("BOS", "A", "Available"),
                               "observed_at": "2026-08-16T00:00:00+00:00"}}
    assert track_injuries.diff({}, previous, "2026-08-17T00:00:00+00:00") == []


def test_a_trade_is_a_new_row_under_the_new_team():
    """Keyed on (team, player): the same name elsewhere is a different fact."""
    current = {("LAL", "A"): _entry("LAL", "A", "Out")}
    previous = {("BOS", "A"): {**_entry("BOS", "A", "Out"),
                               "observed_at": "2026-08-16T00:00:00+00:00"}}
    rows = track_injuries.diff(current, previous, "2026-08-17T00:00:00+00:00")
    teams = {(r["team"], r["status"]) for r in rows}
    assert ("LAL", "Out") in teams
    assert ("BOS", "Available") in teams


def test_uninformative_espn_placeholders_are_dropped_from_the_detail():
    assert track_injuries._describe(
        {"side": "Right", "type": "Achilles", "detail": "Not Specified"}
    ) == "Right achilles"
    assert track_injuries._describe({"detail": "Not Specified"}) is None
    assert track_injuries._describe({}) is None


def test_detail_reads_as_a_sentence_not_as_shouting():
    assert track_injuries._describe(
        {"side": "Left", "type": "Foot", "detail": "Fracture"}
    ) == "Left foot fracture"


def test_latest_state_takes_the_last_row_per_player():
    log = [
        {**_entry("BOS", "A", "Out"), "observed_at": "2026-08-01T00:00:00+00:00"},
        {**_entry("BOS", "A", "Questionable"), "observed_at": "2026-08-05T00:00:00+00:00"},
    ]
    assert track_injuries.latest_state(log)[("BOS", "A")]["status"] == "Questionable"


def test_a_player_with_no_name_or_status_is_skipped_entirely():
    payload = {"injuries": [{"displayName": "Boston Celtics", "injuries": [
        {"athlete": {"displayName": "Real"}, "status": "Out"},
        {"athlete": {}, "status": "Out"},
        {"athlete": {"displayName": "Nostatus"}},
    ]}]}
    assert list(track_injuries.parse(payload)) == [("Boston Celtics", "Real")]


# ---------------------------------------------------------- rehearsal


class _Team:
    def __init__(self, name, conference, wins, losses, **kwargs):
        self.name = name
        self.conference = conference
        self.wins = wins
        self.losses = losses
        for key, value in kwargs.items():
            setattr(self, key, value)


class _Result:
    def __init__(self, teams):
        self.teams = teams


def _healthy_state(n=30):
    teams = []
    for i in range(n):
        teams.append(_Team(
            f"T{i}", "Eastern Conference" if i < n // 2 else "Western Conference",
            41.0, 41.0,
            p_playoffs=0.5, p_play_in=0.1,
            p_championship=1.0 / n,
            p_conference_title=2.0 / n,
        ))
    return {
        "projection": _Result(teams),
        "forecasts": [{
            "p_home": 0.6, "exp_margin": 3.0, "exp_total": 220.0,
        }],
        "games_remaining": 1,
        "games_played": 100,
        "standings": {i: (2, 2) for i in range(50)},
        "season_start": "2025-10-21T00:00:00+00:00",
        "margin_sd": 12.6,
    }


def _failed(state):
    return {c["check"] for c in rehearse.invariants(state, 2026) if not c["ok"]}


def test_a_healthy_state_passes_every_invariant():
    assert _failed(_healthy_state()) == set()


def test_a_championship_distribution_that_does_not_sum_to_one_fails():
    """The single number most likely to drift if the bracket double-counts."""
    state = _healthy_state()
    state["projection"].teams[0].p_championship += 0.05
    assert "championship probability sums to 1" in _failed(state)


def test_a_missing_franchise_fails():
    state = _healthy_state(n=29)
    assert "thirty franchises" in _failed(state)


def test_a_record_that_does_not_total_82_games_fails():
    state = _healthy_state()
    state["projection"].teams[0].wins = 60.0
    state["projection"].teams[0].losses = 10.0
    assert "projected records total 82 games" in _failed(state)


def test_an_impossible_expected_total_fails():
    """The exact bug that shipped once: 14.1 points, the ridge intercept."""
    state = _healthy_state()
    state["forecasts"][0]["exp_total"] = 14.1
    assert "expected total looks like basketball" in _failed(state)


def test_a_forecast_missing_from_the_remaining_slate_fails():
    state = _healthy_state()
    state["games_remaining"] = 5
    assert "every remaining game carries a forecast" in _failed(state)


def test_a_nan_forecast_fails():
    state = _healthy_state()
    state["forecasts"][0]["exp_margin"] = float("nan")
    assert "no forecast is NaN" in _failed(state)


def test_standings_that_do_not_double_count_played_games_fail():
    state = _healthy_state()
    state["games_played"] = 999
    assert "standings account for every played game twice" in _failed(state)


def test_a_probability_outside_the_unit_interval_fails():
    state = _healthy_state()
    state["projection"].teams[0].p_playoffs = 1.4
    assert "every probability is in [0, 1]" in _failed(state)


def test_checkpoints_span_the_whole_season_including_both_ends():
    assert rehearse.CHECKPOINTS[0] == 0.0
    assert rehearse.CHECKPOINTS[-1] == 1.0
    assert list(rehearse.CHECKPOINTS) == sorted(rehearse.CHECKPOINTS)


# ------------------------------------------------------- live win prob


def test_fraction_left_is_one_at_tip_off_and_floored_at_the_buzzer():
    assert fraction_left(REGULATION_SECONDS) == pytest.approx(1.0)
    assert fraction_left(0.0) > 0.0, "a zero fraction divides by zero downstream"
    assert fraction_left(-300.0) > 0.0


def _synthetic(n_games=400, seed=5):
    """Games as random walks, so the fitted model has a known right answer."""
    rng = np.random.default_rng(seed)
    seconds, lead, won = [], [], []
    for _ in range(n_games):
        steps = rng.normal(0.05, 1.4, size=96)  # slight home drift
        path = np.cumsum(steps)
        final = path[-1]
        home_won = 1.0 if final > 0 else 0.0
        for i, value in enumerate(path):
            seconds.append(REGULATION_SECONDS * (1 - (i + 1) / 96))
            lead.append(round(value))
            won.append(home_won)
    return np.array(seconds), np.array(lead), np.array(won)


def test_the_model_learns_that_a_lead_late_is_worth_more_than_a_lead_early():
    seconds, lead, won = _synthetic()
    model = LiveWinProbModel().fit(seconds, lead, won)
    early = model.predict(np.array([2400.0]), np.array([8.0]))[0]
    late = model.predict(np.array([120.0]), np.array([8.0]))[0]
    assert late > early
    assert 0.5 < early < late < 1.0


def test_the_model_is_symmetric_about_a_tied_game():
    seconds, lead, won = _synthetic()
    model = LiveWinProbModel().fit(seconds, lead, won)
    up = model.predict(np.array([600.0]), np.array([6.0]))[0]
    down = model.predict(np.array([600.0]), np.array([-6.0]))[0]
    assert up + down == pytest.approx(1.0, abs=0.08)


def test_probabilities_stay_inside_the_unit_interval_at_absurd_leads():
    seconds, lead, won = _synthetic()
    model = LiveWinProbModel().fit(seconds, lead, won)
    p = model.predict(
        np.array([1.0, 1.0, 2880.0]), np.array([80.0, -80.0, 0.0])
    )
    assert np.all(p >= 0.0) and np.all(p <= 1.0)
    assert np.all(np.isfinite(p))


def test_overtime_is_fitted_separately_rather_than_clamped():
    """A two-point lead in overtime is not a two-point lead with 4s left."""
    seconds = np.concatenate([np.full(500, 600.0), np.full(500, -120.0)])
    lead = np.concatenate([
        np.random.default_rng(1).integers(-10, 11, 500),
        np.random.default_rng(2).integers(-10, 11, 500),
    ]).astype(float)
    won = (lead > 0).astype(float)
    model = LiveWinProbModel().fit(seconds, lead, won)
    assert model.n_overtime == 500
    assert model.overtime is not None
    assert model.regulation is not None


def test_a_model_with_no_overtime_data_still_predicts_in_overtime():
    """It falls back to even money rather than raising on a live game."""
    seconds, lead, won = _synthetic()
    model = LiveWinProbModel().fit(seconds, lead, won)
    model.overtime = None
    assert model.predict(np.array([-60.0]), np.array([3.0]))[0] == 0.5


def test_the_baseline_is_the_home_rate_not_a_coin_flip():
    assert tied_game_baseline([True] * 55 + [False] * 45) == pytest.approx(0.55)
    assert tied_game_baseline([]) == 0.5


def test_the_sigmoid_does_not_overflow_on_a_huge_standardised_lead():
    seconds, lead, won = _synthetic()
    model = LiveWinProbModel().fit(seconds, lead, won)
    with np.errstate(over="raise"):
        p = model.predict(np.array([0.5]), np.array([50.0]))
    assert np.isfinite(p).all()


# --------------------------------------------------------- comebacks


def _game(gid, q_home, q_away, **kwargs):
    return {
        "id": gid,
        "date": "2015-01-02T00:00:00+00:00",
        "phase": "Final",
        "home": kwargs.get("home", "HOM"),
        "away": kwargs.get("away", "AWY"),
        "home_score": sum(q_home),
        "away_score": sum(q_away),
        "q_home": q_home,
        "q_away": q_away,
        "ot": kwargs.get("ot", 0),
    }


def test_a_comeback_measures_the_worst_quarter_break_deficit():
    # Home trails 20-40 after Q1, 45-60 at half, then wins.
    board = build_comebacks({2015: {"games": [
        _game("g", [20, 25, 35, 30], [40, 20, 20, 20]),
    ]}})
    row = board["comebacks"][0]
    assert row["deficit"] == 20
    assert row["after_period"] == 1


def test_the_final_quarter_break_is_never_counted():
    """The score after the last period is the result, not a deficit."""
    board = build_comebacks({2015: {"games": [
        _game("g", [30, 30, 30, 30], [25, 25, 25, 25]),
    ]}})
    assert board["comebacks"] == []


def test_a_wire_to_wire_win_is_not_a_comeback():
    board = build_comebacks({2015: {"games": [
        _game("g", [30, 30, 30, 30], [20, 20, 20, 20]),
    ]}})
    assert board["n_comebacks"] == 0


def test_the_away_side_comeback_is_measured_from_its_own_perspective():
    board = build_comebacks({2015: {"games": [
        _game("g", [40, 20, 20, 15], [20, 25, 30, 35]),
    ]}})
    row = board["comebacks"][0]
    assert row["winner"] == "AWY"
    assert row["deficit"] == 20


def test_a_game_without_quarters_is_skipped_rather_than_crashing():
    game = _game("g", [30, 30, 30, 30], [20, 20, 20, 20])
    game["q_home"] = None
    assert build_comebacks({2015: {"games": [game]}})["n_comebacks"] == 0


def test_warmup_seasons_are_on_the_comeback_board():
    """A comeback is a fact about the game, not about the model."""
    board = build_comebacks({2004: {"games": [
        _game("g", [20, 25, 35, 30], [40, 20, 20, 20]),
    ]}})
    assert board["n_comebacks"] == 1
    assert board["comebacks"][0]["p_model"] is None


def test_the_board_says_it_is_a_lower_bound():
    board = build_comebacks({2015: {"games": []}})
    assert "lower bound" in board["note"].lower()
    assert "quarter break" in board["measure"]
