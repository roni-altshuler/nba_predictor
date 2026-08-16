"""The cross-season upset boards.

Nothing here computes a forecast — the boards are a sort over numbers the
archive already stored. The tests are therefore about the sort being the one
claimed, and about the two ways a leaderboard silently lies: including games
the model never forecast, and orienting a probability to the wrong side.
"""

from __future__ import annotations

import pytest

from backend.scripts.build_history import build_upsets


def game(gid, *, home="HOM", away="AWY", hs=100, as_=95, p_model=0.6,
         p_market=None, exp_margin=None, phase="Final", date="2015-01-02T00:00:00+00:00"):
    record = {
        "id": gid,
        "date": date,
        "phase": phase,
        "home": home,
        "away": away,
        "home_score": hs,
        "away_score": as_,
        "p_model": p_model,
    }
    if p_market is not None:
        record["p_market"] = p_market
    if exp_margin is not None:
        record["exp_margin"] = exp_margin
    return record


def seasons(*payloads):
    return {2015 + i: {"games": list(g)} for i, g in enumerate(payloads)}


# ------------------------------------------------------------ orientation


def test_probability_is_oriented_to_the_team_that_actually_won():
    """The single easiest thing to get backwards on this page.

    `p_model` is a HOME probability. An away upset is a low probability for
    the away side, which is a HIGH `p_model` — sorting on `p_model` directly
    would put every home favourite's loss at the top and every away
    favourite's loss at the bottom, and the board would look plausible.
    """
    board = build_upsets(seasons([
        # Away side wins as a heavy underdog: p_model .95 for the home team.
        game("away-upset", hs=95, as_=100, p_model=0.95),
        # Home side wins as a mild favourite. Not an upset.
        game("home-chalk", hs=110, as_=90, p_model=0.60),
    ]))
    top = board["upsets"][0]
    assert top["id"] == "away-upset"
    assert top["winner"] == "AWY"
    assert top["p_winner"] == pytest.approx(0.05)


def test_winner_and_loser_follow_the_score_not_the_home_field():
    board = build_upsets(seasons([game("g", home="BOS", away="LAL", hs=90, as_=101)]))
    row = board["upsets"][0]
    assert row["winner"] == "LAL"
    assert row["loser"] == "BOS"
    assert row["winner_home"] is False


def test_upsets_are_sorted_most_surprising_first():
    # `p_model` is a HOME probability throughout, so an away win at .98
    # is the wild upset and a home win at .55 is barely one.
    board = build_upsets(seasons([
        game("mild", p_model=0.55),
        game("wild", p_model=0.98, hs=90, as_=100),
        game("middling", p_model=0.70, hs=90, as_=100),
    ]))
    assert [row["id"] for row in board["upsets"]] == ["wild", "middling", "mild"]


# --------------------------------------------------------------- warm-up


def test_a_game_with_no_forecast_appears_on_no_board():
    """The warm-up seasons were fitted on. A number for them would have
    seen the answer, so the archive stores none — and the boards must not
    invent one or silently treat a missing forecast as zero, which would
    make every warm-up game the biggest upset in history."""
    warmup = game("warmup", p_model=0.6)
    del warmup["p_model"]
    board = build_upsets(seasons([warmup, game("real", p_model=0.4)]))
    assert [row["id"] for row in board["upsets"]] == ["real"]
    assert board["n_scored"] == 1


def test_a_none_forecast_is_treated_the_same_as_a_missing_one():
    board = build_upsets(seasons([game("null", p_model=None), game("real")]))
    assert [row["id"] for row in board["upsets"]] == ["real"]


# ---------------------------------------------------------- disagreements


def test_disagreement_needs_both_forecasters():
    board = build_upsets(seasons([
        game("priced", p_model=0.7, p_market=0.4),
        game("unpriced", p_model=0.7),
    ]))
    assert [row["id"] for row in board["disagreements"]] == ["priced"]
    assert board["disagreement_record"]["n"] == 1


def test_closer_is_decided_on_the_winning_side_not_the_home_side():
    board = build_upsets(seasons([
        # Away team wins. Model gave home .20 (so away .80); market gave home
        # .80 (so away .20). The model was closer.
        game("g", hs=90, as_=100, p_model=0.20, p_market=0.80),
    ]))
    row = board["disagreements"][0]
    assert row["p_winner"] == pytest.approx(0.80)
    assert row["p_winner_market"] == pytest.approx(0.20)
    assert row["closer"] == "model"


def test_disagreement_record_counts_the_whole_corpus_not_the_top_slice():
    """The number the page leads with has to be the one with power.

    A board sorted by disagreement is selected on exactly the games where one
    side was furthest out on a limb; the full-corpus split is the honest
    figure and both are published so the page can say which is which.
    """
    games = [game(f"m{i}", p_model=0.9, p_market=0.5, hs=110, as_=90) for i in range(5)]
    games += [game(f"k{i}", p_model=0.1, p_market=0.5, hs=110, as_=90) for i in range(3)]
    board = build_upsets(seasons(games), limit=2)
    record = board["disagreement_record"]
    assert record["n"] == 8
    assert record["model_closer"] == 5
    assert record["market_closer"] == 3
    assert record["top_n"] == 2
    assert len(board["disagreements"]) == 2


def test_disagreements_are_sorted_by_the_gap_between_the_two():
    board = build_upsets(seasons([
        game("near", p_model=0.55, p_market=0.50),
        game("far", p_model=0.90, p_market=0.20),
        game("mid", p_model=0.70, p_market=0.45),
    ]))
    assert [row["id"] for row in board["disagreements"]] == ["far", "mid", "near"]


# --------------------------------------------------------- margin misses


def test_margin_misses_measure_the_absolute_error():
    board = build_upsets(seasons([
        game("blowout", hs=150, as_=90, exp_margin=2.0),   # off by 58
        game("close", hs=101, as_=100, exp_margin=3.0),    # off by 2
    ]))
    assert [row["id"] for row in board["margin_misses"]] == ["blowout", "close"]
    assert board["margin_misses"][0]["error"] == pytest.approx(58.0)
    assert board["margin_misses"][0]["actual_margin"] == 60


def test_margin_error_is_signed_correctly_when_the_home_side_loses():
    board = build_upsets(seasons([game("g", hs=90, as_=110, exp_margin=5.0)]))
    row = board["margin_misses"][0]
    assert row["actual_margin"] == -20
    assert row["error"] == pytest.approx(25.0)


def test_a_game_without_an_expected_margin_is_not_on_the_margin_board():
    board = build_upsets(seasons([game("no-margin"), game("has", exp_margin=1.0)]))
    assert [row["id"] for row in board["margin_misses"]] == ["has"]


# ---------------------------------------------------------------- shape


def test_boards_are_capped_at_the_limit():
    board = build_upsets(
        seasons([game(f"g{i}", p_model=i / 100, hs=90, as_=100) for i in range(50)]),
        limit=5,
    )
    assert len(board["upsets"]) == 5


def test_every_board_row_carries_a_game_id_that_can_be_linked():
    board = build_upsets(seasons([
        game("g1", p_model=0.4, p_market=0.5, exp_margin=1.0),
    ]))
    for key in ("upsets", "disagreements", "margin_misses"):
        assert board[key][0]["id"] == "g1"
        assert board[key][0]["season"] == 2015


def test_the_payload_is_labelled_a_backtest():
    board = build_upsets(seasons([game("g")]))
    assert board["basis"] == "backtest"
    assert "nobody read these numbers" in board["note"].lower()


def test_multiple_seasons_are_ranked_against_each_other():
    board = build_upsets({
        2015: {"games": [game("old", p_model=0.70, hs=90, as_=100)]},
        2024: {"games": [game("new", p_model=0.95, hs=90, as_=100)]},
    })
    assert [row["id"] for row in board["upsets"]] == ["new", "old"]
    assert board["seasons"] == [2015, 2024]


def test_an_empty_corpus_produces_empty_boards_rather_than_failing():
    board = build_upsets({})
    assert board["n_scored"] == 0
    assert board["upsets"] == []
    assert board["disagreement_record"]["n"] == 0
