"""Forecast provenance, the live record, and the continuous scoring rules.

The centre of gravity here is one property: **a forecast counts as live only
if it was written down before the ball went up.** Everything in
`score_live` exists to enforce that, and every test below is either a check
that it holds or a check that a near-miss is refused rather than quietly
counted.
"""

from __future__ import annotations

import math

import pytest

from backend.scripts import score_live
from backend.services.data.warehouse import Warehouse
from backend.services.prediction import market as mkt


# --------------------------------------------------------------- fixtures


@pytest.fixture()
def warehouse(tmp_path):
    house = Warehouse(tmp_path / "test.sqlite")
    house.migrate()
    house.upsert_competition(competition_id="nba", name="NBA", level="major")
    yield house
    house.close()


def snapshot(fixture_uid, generated_at, tipoff, p_home, **kwargs):
    return {
        "fixture_uid": fixture_uid,
        "generated_at": generated_at,
        "model_version": kwargs.get("model_version", "test.1"),
        "competition_id": "nba",
        "season": kwargs.get("season", 2027),
        "tipoff_utc": tipoff,
        "home_team": kwargs.get("home_team", "HOM"),
        "away_team": kwargs.get("away_team", "AWY"),
        "p_home": p_home,
        "p_away": 1 - p_home if p_home is not None else None,
        "exp_margin": kwargs.get("exp_margin"),
        "exp_total": kwargs.get("exp_total"),
    }


# ------------------------------------------------------ provenance writes


def test_snapshots_are_append_only_across_generated_at(warehouse):
    warehouse.record_predictions([
        snapshot("g1", "2027-01-01T12:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.6),
        snapshot("g1", "2027-01-01T23:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.64),
    ])
    rows = list(warehouse.conn.execute("SELECT * FROM prediction_snapshots"))
    assert len(rows) == 2, "a later run must add an observation, not replace one"


def test_rerunning_the_same_second_overwrites_rather_than_duplicates(warehouse):
    for _ in range(3):
        warehouse.record_predictions([
            snapshot("g1", "2027-01-01T12:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.6),
        ])
    rows = list(warehouse.conn.execute("SELECT * FROM prediction_snapshots"))
    assert len(rows) == 1, "the publisher must be idempotent within one run"


def test_earliest_prediction_is_the_one_taken(warehouse):
    warehouse.record_predictions([
        snapshot("g1", "2027-01-01T23:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.70),
        snapshot("g1", "2027-01-01T06:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.61),
        snapshot("g1", "2027-01-01T12:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.66),
    ])
    rows = warehouse.earliest_predictions()
    assert len(rows) == 1
    # The furthest from the game, with the least information — the hardest
    # version of the claim, and the one nobody can say crept toward the line.
    assert rows[0]["p_home"] == pytest.approx(0.61)


def test_a_forecast_stamped_after_tipoff_is_not_a_forecast(warehouse):
    warehouse.record_predictions([
        snapshot("late", "2027-01-02T02:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.9),
    ])
    assert warehouse.earliest_predictions() == []


def test_a_snapshot_with_no_tipoff_is_dropped(warehouse):
    """An unknown tipoff cannot be shown to have come after anything."""
    warehouse.record_predictions([
        snapshot("nodate", "2027-01-01T12:00:00+00:00", None, 0.6),
    ])
    assert warehouse.earliest_predictions() == []


def test_the_late_snapshot_does_not_rescue_a_fixture_whose_others_were_late(
    warehouse,
):
    """A game forecast only after tip-off contributes nothing at all.

    The dangerous version of this bug is subtle: filter on tipoff AFTER
    grouping and the earliest row for the fixture is the late one, which then
    passes the filter for the wrong reason. Both filters are inside the
    subquery for that reason.
    """
    warehouse.record_predictions([
        snapshot("g1", "2027-01-02T01:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.9),
        snapshot("g1", "2027-01-02T03:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.95),
        snapshot("g2", "2027-01-01T09:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.55),
    ])
    rows = warehouse.earliest_predictions()
    assert [r["fixture_uid"] for r in rows] == ["g2"]


def test_season_filter_is_applied(warehouse):
    warehouse.record_predictions([
        snapshot("a", "2026-01-01T00:00:00+00:00", "2026-01-02T00:00:00+00:00", 0.5,
                 season=2026),
        snapshot("b", "2027-01-01T00:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.5,
                 season=2027),
    ])
    assert [r["fixture_uid"] for r in warehouse.earliest_predictions(season=2027)] == ["b"]


def test_a_missing_price_is_stored_as_null_never_as_zero(warehouse):
    warehouse.record_odds([{
        "game_id": "g1", "provider": "publish",
        "captured_at": "2027-01-01T12:00:00+00:00",
        "ml_home": None, "ml_away": "", "spread_home": -3.5,
        "total_points": None,
    }])
    row = warehouse.conn.execute("SELECT * FROM odds_snapshots").fetchone()
    assert row["ml_home"] is None
    assert row["ml_away"] is None, "an empty string must not become 0.0"
    assert row["spread_home"] == pytest.approx(-3.5)


def test_earliest_odds_takes_the_first_capture(warehouse):
    for at, ml in (("2027-01-01T20:00:00+00:00", -150), ("2027-01-01T08:00:00+00:00", -130)):
        warehouse.record_odds([{
            "game_id": "g1", "provider": "publish", "captured_at": at,
            "ml_home": ml, "ml_away": 120,
        }])
    assert warehouse.earliest_odds()["g1"]["ml_home"] == pytest.approx(-130)


# ------------------------------------------------------------- the record


def test_empty_record_is_a_state_not_an_error():
    report = score_live.evaluate([])
    assert report["n"] == 0
    assert report["paired_vs_market"]["verdict"] == "insufficient"
    assert report["clv"]["flagged"]["n"] == 0


def _record(p_home, home_won, **kwargs):
    margin = kwargs.get("margin", 5 if home_won else -5)
    return {
        "game_id": kwargs.get("game_id", "g"),
        "tipoff_utc": kwargs.get("tipoff", "2027-01-02T00:00:00+00:00"),
        "generated_at": "2027-01-01T12:00:00+00:00",
        "lead_hours": 12.0,
        "p_home": p_home,
        "home_won": home_won,
        "margin": margin,
        "total": kwargs.get("total", 220),
        "exp_margin": kwargs.get("exp_margin", 3.0),
        "exp_total": kwargs.get("exp_total", 218.0),
        "ml_home": kwargs.get("ml_home"),
        "ml_away": kwargs.get("ml_away"),
        "spread_home": kwargs.get("spread_home"),
        "clv": kwargs.get("clv"),
    }


def test_a_short_record_refuses_to_claim_anything():
    """Ten right calls in a row is a good week, not a beaten market."""
    records = [
        _record(0.9, True, game_id=f"g{i}", ml_home=-110, ml_away=-110)
        for i in range(10)
    ]
    report = score_live.evaluate(records)
    assert report["n"] == 10
    assert report["paired_vs_market"]["verdict"] == "insufficient"


def test_beating_the_market_is_reported_as_suspicious_not_as_a_win():
    """The standing rule, enforced in the artifact rather than in prose.

    A model with no market features cannot out-predict the closing line. If
    the interval ever says it did, the page must say "suspect the harness",
    because that is what the project's own rules require of it.
    """
    # The model is right every time; the market is priced at a coin flip.
    records = [
        _record(0.99, True, game_id=f"g{i}", ml_home=-110, ml_away=-110)
        for i in range(60)
    ]
    report = score_live.evaluate(records)
    assert report["paired_vs_market"]["verdict"] == "model_better_suspect_the_harness"


def test_the_market_being_better_is_the_ordinary_verdict():
    records = [
        _record(0.5, i % 2 == 0, game_id=f"g{i}", ml_home=-100000, ml_away=100000)
        if i % 2 == 0
        else _record(0.5, False, game_id=f"g{i}", ml_home=100000, ml_away=-100000)
        for i in range(60)
    ]
    report = score_live.evaluate(records)
    assert report["paired_vs_market"]["verdict"] == "market_better"


def test_margin_and_total_are_scored_on_the_live_record_too():
    records = [_record(0.6, True, game_id=f"g{i}", margin=8, exp_margin=3.0)
               for i in range(5)]
    report = score_live.evaluate(records)
    assert report["margin"]["n"] == 5
    assert report["margin"]["mae"] == pytest.approx(5.0)
    # Predicted minus actual: the model was five points SHORT, so the bias
    # is negative. A sign flip here would read as the opposite fault.
    assert report["margin"]["bias"] == pytest.approx(-5.0)


# ------------------------------------------------------------------- CLV


def _clv_for(taken_home, taken_away, close_home, close_away, p_home=0.60):
    record = _record(p_home, True, ml_home=close_home, ml_away=close_away)
    taken = {"ml_home": taken_home, "ml_away": taken_away}
    return score_live._clv(record, taken, "shin")


def test_clv_is_positive_when_the_price_shortened_after_we_called_it():
    clv = _clv_for(taken_home=-120, taken_away=110, close_home=-160, close_away=140)
    assert clv["side"] == "home"
    assert clv["clv"] > 0, "we took +EV odds and the market moved to us"
    assert clv["beat_close"] is True


def test_clv_is_negative_when_the_market_moved_away_from_us():
    clv = _clv_for(taken_home=-160, taken_away=140, close_home=-120, close_away=110)
    assert clv["clv"] < 0
    assert clv["beat_close"] is False


def test_clv_needs_both_a_taken_price_and_a_close():
    assert score_live._clv(_record(0.6, True), None, "shin") is None
    # A close with no stored capture: nothing to measure FROM.
    assert score_live._clv(
        _record(0.6, True, ml_home=-110, ml_away=-110),
        {"ml_home": None, "ml_away": None},
        "shin",
    ) is None
    # A capture with no close: nothing to measure TO.
    assert score_live._clv(
        _record(0.6, True),
        {"ml_home": -110, "ml_away": -110},
        "shin",
    ) is None


def test_only_calls_over_the_threshold_are_flagged():
    # A model probability equal to the fair price is a zero edge.
    tiny = _clv_for(-110, -110, -110, -110, p_home=0.50)
    assert tiny["flagged"] is False
    big = _clv_for(-110, -110, -110, -110, p_home=0.80)
    assert big["flagged"] is True


def test_clv_summary_separates_flagged_from_merely_priced():
    records = [
        _record(0.8, True, game_id="a", clv={
            "flagged": True, "clv": 0.05, "beat_close": True, "won": True,
            "profit": 0.9,
        }),
        _record(0.5, False, game_id="b", clv={
            "flagged": False, "clv": -0.10, "beat_close": False, "won": False,
            "profit": -1.0,
        }),
    ]
    summary = score_live._clv_summary(records)
    assert summary["flagged"]["n"] == 1
    assert summary["all_priced"]["n"] == 2
    assert summary["flagged"]["mean_clv"] == pytest.approx(0.05)
    assert summary["flagged"]["record"] == "1-0"


# ------------------------------------------- continuous scoring primitives


def test_summarise_continuous_keeps_the_sign_of_the_bias():
    long_by_three = [(10.0, 7.0), (20.0, 17.0), (0.0, -3.0)]
    out = mkt.summarise_continuous(long_by_three)
    assert out["mae"] == pytest.approx(3.0)
    assert out["bias"] == pytest.approx(3.0)
    assert out["rmse"] == pytest.approx(3.0)


def test_mae_and_bias_disagree_when_errors_cancel():
    """The whole reason bias is reported separately from MAE."""
    out = mkt.summarise_continuous([(5.0, 0.0), (-5.0, 0.0)])
    assert out["mae"] == pytest.approx(5.0)
    assert out["bias"] == pytest.approx(0.0)


def test_a_correct_distribution_covers_its_nominal_intervals():
    """Draws from the model's own normal must cover at the stated rate.

    Deterministic by construction rather than by sampling: the outcomes are
    placed at the exact quantiles of the predicted distribution, so the
    realised coverage is arithmetic and the test cannot flake.
    """
    n = 2001
    triples = [
        (0.0, mkt._normal_ppf(i / (n + 1)) * 10.0, 10.0) for i in range(1, n + 1)
    ]
    rows = {row["nominal"]: row for row in mkt.interval_coverage(triples)}
    for level in (0.5, 0.8, 0.95):
        assert rows[level]["coverage"] == pytest.approx(level, abs=0.01)


def test_a_too_narrow_sd_under_covers_and_the_gap_is_negative():
    """The failure mode with consequences on every other page."""
    n = 2001
    # Outcomes are drawn from sd 20; the model publishes 10.
    triples = [
        (0.0, mkt._normal_ppf(i / (n + 1)) * 20.0, 10.0) for i in range(1, n + 1)
    ]
    rows = {row["nominal"]: row for row in mkt.interval_coverage(triples)}
    assert rows[0.5]["coverage"] < 0.5
    assert rows[0.5]["gap"] < 0
    assert rows[0.95]["coverage"] < 0.95


def test_pit_of_a_correct_distribution_is_flat():
    n = 5000
    triples = [
        (0.0, mkt._normal_ppf(i / (n + 1)) * 13.0, 13.0) for i in range(1, n + 1)
    ]
    table = mkt.pit_histogram(mkt.pit_values(triples))
    assert len(table) == 10
    for row in table:
        assert row["share"] == pytest.approx(0.1, abs=0.01)
    assert mkt.pit_uniformity(mkt.pit_values(triples))["chi_square_per_dof"] < 1.5


def test_pit_catches_a_biased_forecast_that_mae_alone_would_not_explain():
    n = 2001
    # Every outcome sits above the prediction: the PIT piles up in the top
    # bins even though the spread is right.
    triples = [
        (0.0, mkt._normal_ppf(i / (n + 1)) * 10.0 + 15.0, 10.0)
        for i in range(1, n + 1)
    ]
    table = mkt.pit_histogram(mkt.pit_values(triples))
    assert table[-1]["share"] > 0.3
    assert table[0]["share"] < 0.01


def test_pit_drops_a_non_positive_sd_rather_than_repairing_it():
    """A point forecast published as a distribution is a bug to find."""
    assert mkt.pit_values([(0.0, 5.0, 0.0)]) == []
    assert mkt.pit_values([(0.0, 5.0, -3.0)]) == []
    assert mkt.pit_values([(0.0, 5.0, float("nan"))]) == []


def test_empty_pit_histogram_is_empty_not_ten_zero_bins():
    assert mkt.pit_histogram([]) == []
    assert mkt.pit_uniformity([]) == {"n": 0}


def test_pit_histogram_bins_are_exhaustive_and_sum_to_one():
    values = [i / 1000 for i in range(1000)]
    table = mkt.pit_histogram(values)
    assert sum(row["count"] for row in table) == 1000
    assert sum(row["share"] for row in table) == pytest.approx(1.0, abs=1e-9)


def test_pit_value_of_exactly_one_lands_in_the_last_bin():
    """The upper edge must not index off the end of the array."""
    table = mkt.pit_histogram([1.0])
    assert table[-1]["count"] == 1


def test_normal_ppf_inverts_the_cdf():
    for p in (0.01, 0.25, 0.5, 0.75, 0.975, 0.999):
        assert mkt._normal_cdf(mkt._normal_ppf(p)) == pytest.approx(p, abs=1e-6)
    assert mkt._normal_ppf(0.5) == pytest.approx(0.0, abs=1e-9)
    # The half-widths every coverage row is built from.
    assert mkt._normal_ppf(0.975) == pytest.approx(1.959964, abs=1e-5)


def test_normal_ppf_refuses_a_degenerate_probability():
    for bad in (0.0, 1.0, -0.1, 1.1):
        with pytest.raises(ValueError):
            mkt._normal_ppf(bad)


def test_interval_coverage_on_an_empty_set_is_zero_not_a_crash():
    rows = mkt.interval_coverage([])
    assert all(row["n"] == 0 and row["coverage"] == 0.0 for row in rows)


def test_lead_hours_is_the_gap_from_publication_to_tipoff():
    assert score_live._hours_between(
        "2027-01-01T12:00:00+00:00", "2027-01-02T00:00:00+00:00"
    ) == pytest.approx(12.0)
    assert score_live._hours_between(None, "2027-01-02T00:00:00+00:00") is None
    assert score_live._hours_between("nonsense", "2027-01-02T00:00:00+00:00") is None


def test_median_handles_both_parities_and_emptiness():
    assert score_live._median([]) is None
    assert score_live._median([3.0]) == 3.0
    assert score_live._median([1.0, 3.0]) == 2.0
    assert score_live._median([5.0, 1.0, 3.0]) == 3.0


def test_signed_errors_do_not_lose_direction():
    assert mkt.signed_errors([(3.0, 1.0), (1.0, 3.0)]) == [2.0, -2.0]


def test_summarise_continuous_on_nothing_reports_nothing():
    assert mkt.summarise_continuous([]) == {"n": 0}


def test_median_absolute_error_is_robust_to_one_blowout():
    pairs = [(0.0, 1.0)] * 10 + [(0.0, 500.0)]
    out = mkt.summarise_continuous(pairs)
    assert out["median_ae"] == pytest.approx(1.0)
    assert out["mae"] > 40, "the mean is dragged and the median is not"
    assert math.isfinite(out["rmse"])


# ---------------------------------------------------- the durable log


def test_forecast_log_first_write_wins(tmp_path):
    """A later, better number does not get to replace the published one."""
    from backend.scripts.forecast_season import append_forecast_log

    path = tmp_path / "forecast_log.json"
    game = {
        "game_id": "g1",
        "date_utc": "2027-01-02T00:00:00+00:00",
        "home": {"abbreviation": "HOM"},
        "away": {"abbreviation": "AWY"},
        "p_home": 0.55,
        "exp_margin": 1.0,
        "exp_total": 210.0,
    }
    assert append_forecast_log(
        path, [game], season=2027, generated_at="2027-01-01T06:00:00+00:00",
        version="v1",
    ) == 1
    assert append_forecast_log(
        path, [{**game, "p_home": 0.80}], season=2027,
        generated_at="2027-01-01T23:00:00+00:00", version="v2",
    ) == 0

    import json
    payload = json.loads(path.read_text())
    entry = payload["forecasts"]["g1"]
    assert entry["p_home"] == pytest.approx(0.55)
    assert entry["model_version"] == "v1"
    assert payload["n"] == 1


def test_forecast_log_refuses_a_post_tipoff_stamp(tmp_path):
    from backend.scripts.forecast_season import append_forecast_log

    path = tmp_path / "forecast_log.json"
    added = append_forecast_log(
        path,
        [{
            "game_id": "late",
            "date_utc": "2027-01-02T00:00:00+00:00",
            "home": {"abbreviation": "HOM"},
            "away": {"abbreviation": "AWY"},
            "p_home": 0.55,
        }],
        season=2027,
        generated_at="2027-01-02T04:00:00+00:00",
        version="v1",
    )
    assert added == 0
    assert not path.exists()


def test_forecast_log_stores_the_price_the_call_was_made_against(tmp_path):
    from backend.scripts.forecast_season import append_forecast_log

    path = tmp_path / "forecast_log.json"
    append_forecast_log(
        path,
        [{
            "game_id": "g1",
            "date_utc": "2027-01-02T00:00:00+00:00",
            "home": {"abbreviation": "HOM"},
            "away": {"abbreviation": "AWY"},
            "p_home": 0.55,
            "value": {"ml_home": -140, "ml_away": 120},
        }],
        season=2027,
        generated_at="2027-01-01T06:00:00+00:00",
        version="v1",
    )
    import json
    entry = json.loads(path.read_text())["forecasts"]["g1"]
    assert entry["ml_home"] == -140
    assert entry["ml_away"] == 120


def test_the_log_survives_a_wiped_warehouse(warehouse, tmp_path):
    """The whole reason the file exists.

    One failed release download and the daily job rebuilds the warehouse from
    ESPN. Results and prices come back; a forecast made before a game never
    could. Scoring must still work from the committed file alone.
    """
    import json

    path = tmp_path / "forecast_log.json"
    path.write_text(json.dumps({
        "forecasts": {
            "g1": {
                "generated_at": "2027-01-01T06:00:00+00:00",
                "model_version": "v1",
                "season": 2027,
                "tipoff_utc": "2027-01-02T00:00:00+00:00",
                "home_team": "HOM",
                "away_team": "AWY",
                "p_home": 0.62,
                "exp_margin": 3.0,
                "exp_total": 220.0,
                "ml_home": -150,
                "ml_away": 130,
            }
        }
    }))
    # The warehouse has no prediction_snapshots at all.
    rows = score_live.earliest_forecasts(warehouse, 2027, path)
    assert [r["fixture_uid"] for r in rows] == ["g1"]
    assert rows[0]["p_home"] == pytest.approx(0.62)
    assert rows[0]["taken_ml_home"] == -150


def test_the_log_wins_when_it_is_earlier_than_the_warehouse(warehouse, tmp_path):
    import json

    warehouse.record_predictions([
        snapshot("g1", "2027-01-01T18:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.70),
    ])
    path = tmp_path / "forecast_log.json"
    path.write_text(json.dumps({"forecasts": {"g1": {
        "generated_at": "2027-01-01T06:00:00+00:00",
        "season": 2027,
        "tipoff_utc": "2027-01-02T00:00:00+00:00",
        "p_home": 0.62,
    }}}))
    rows = score_live.earliest_forecasts(warehouse, 2027, path)
    assert rows[0]["p_home"] == pytest.approx(0.62)


def test_the_warehouse_wins_when_it_is_earlier_than_the_log(warehouse, tmp_path):
    """Taking the later of two pre-tipoff forecasts would weaken the claim."""
    import json

    warehouse.record_predictions([
        snapshot("g1", "2027-01-01T02:00:00+00:00", "2027-01-02T00:00:00+00:00", 0.70),
    ])
    path = tmp_path / "forecast_log.json"
    path.write_text(json.dumps({"forecasts": {"g1": {
        "generated_at": "2027-01-01T06:00:00+00:00",
        "season": 2027,
        "tipoff_utc": "2027-01-02T00:00:00+00:00",
        "p_home": 0.62,
        "ml_home": -150,
        "ml_away": 130,
    }}}))
    rows = score_live.earliest_forecasts(warehouse, 2027, path)
    assert rows[0]["p_home"] == pytest.approx(0.70)
    # ...but the price stored beside the log entry is still picked up, since
    # the warehouse row carries none of its own.
    assert rows[0]["taken_ml_home"] == -150


def test_a_missing_or_corrupt_log_is_not_fatal(warehouse, tmp_path):
    assert score_live.earliest_forecasts(warehouse, 2027, tmp_path / "nope.json") == []
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json")
    assert score_live.earliest_forecasts(warehouse, 2027, bad) == []


def test_the_log_respects_the_season_filter(warehouse, tmp_path):
    import json

    path = tmp_path / "forecast_log.json"
    path.write_text(json.dumps({"forecasts": {
        "old": {
            "generated_at": "2026-01-01T06:00:00+00:00", "season": 2026,
            "tipoff_utc": "2026-01-02T00:00:00+00:00", "p_home": 0.5,
        },
        "new": {
            "generated_at": "2027-01-01T06:00:00+00:00", "season": 2027,
            "tipoff_utc": "2027-01-02T00:00:00+00:00", "p_home": 0.5,
        },
    }}))
    rows = score_live.earliest_forecasts(warehouse, 2027, path)
    assert [r["fixture_uid"] for r in rows] == ["new"]
