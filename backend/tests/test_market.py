"""Market mathematics.

Each test pins a property that, if it broke, would silently corrupt the
benchmark rather than raise anything.
"""

from __future__ import annotations

import math

import pytest

from backend.services.prediction import market as mkt


class TestOddsConversion:
    def test_american_to_decimal_favourite(self):
        # -218 means risk 218 to win 100 → 1.4587 decimal.
        assert mkt.american_to_decimal(-218) == pytest.approx(1.45872, rel=1e-4)

    def test_american_to_decimal_underdog(self):
        assert mkt.american_to_decimal(180) == pytest.approx(2.80)

    def test_round_trip(self):
        for american in (-500, -218, -110, 100, 180, 450):
            decimal = mkt.american_to_decimal(american)
            assert mkt.decimal_to_american(decimal) == pytest.approx(american, rel=1e-6)

    def test_zero_is_not_a_price(self):
        # Zero is what an empty field coerces to, so it must raise rather
        # than silently produce decimal odds of 1.0.
        with pytest.raises(mkt.InvalidOddsError):
            mkt.american_to_decimal(0)


class TestDevig:
    def test_proportional_sums_to_one(self):
        p_home, p_away = mkt.devig_proportional(-218, 180)
        assert p_home + p_away == pytest.approx(1.0)

    def test_shin_sums_to_one(self):
        p_home, p_away = mkt.devig_shin(-218, 180)
        assert p_home + p_away == pytest.approx(1.0)

    def test_favourite_keeps_the_larger_share(self):
        p_home, p_away = mkt.devig(-218, 180)
        assert p_home > p_away

    def test_shin_and_proportional_agree_near_even_money(self):
        """Pins the measured table in market.py's docstring.

        The two methods are interchangeable around pick'em and are NOT
        interchangeable at a heavy favourite — see the divergence test
        below. Stated as a measurement rather than a theorem, so it needs a
        test on both sides.
        """
        for ml_home, ml_away in ((-110, -110), (-130, 110), (-150, 130)):
            shin = mkt.devig_shin(ml_home, ml_away)[0]
            prop = mkt.devig_proportional(ml_home, ml_away)[0]
            assert abs(shin - prop) < 0.003

    def test_shin_and_proportional_diverge_at_a_heavy_favourite(self):
        """The correction that matters, and the reason the method is recorded.

        At -1000 the two differ by ~.016 — larger than the gap between this
        model and the market. Treating them as interchangeable would move
        the benchmark by more than any modelling change in this repo.
        """
        shin = mkt.devig_shin(-1000, 650)[0]
        prop = mkt.devig_proportional(-1000, 650)[0]
        assert abs(shin - prop) > 0.01
        # Shin puts MORE on the favourite: it attributes part of the
        # overround to insider money rather than spreading it evenly.
        assert shin > prop

    def test_divergence_grows_with_the_favourite(self):
        gaps = [
            abs(mkt.devig_shin(h, a)[0] - mkt.devig_proportional(h, a)[0])
            for h, a in ((-110, -110), (-218, 180), (-400, 320), (-1000, 650))
        ]
        assert gaps == sorted(gaps)

    def test_booksum_exceeds_one_on_a_real_market(self):
        assert mkt.booksum(-110, -110) > 1.0
        # Two -110 legs imply .5238 each, so the book takes 4.76%.
        assert mkt.overround(-110, -110) == pytest.approx(0.0476, abs=1e-3)

    def test_refuses_two_legs_from_different_games(self):
        # Two heavy favourites cannot be the two sides of one game; the
        # booksum guard is what stops a mis-join being scored as a market.
        with pytest.raises(mkt.InvalidOddsError):
            mkt.devig_proportional(-500, -500)

    def test_one_leg_is_not_a_market(self):
        assert not mkt.has_complete_odds(-218, None)
        assert not mkt.has_complete_odds(None, 180)
        assert mkt.has_complete_odds(-218, 180)


class TestSpreadToProbability:
    def test_pick_em_is_a_coin_flip(self):
        assert mkt.spread_to_probability(0.0) == pytest.approx(0.5)

    def test_home_favourite_has_a_negative_spread(self):
        # -5.5 means the home side gives 5.5 points, so it is favoured.
        assert mkt.spread_to_probability(-5.5) > 0.5
        assert mkt.spread_to_probability(5.5) < 0.5

    def test_monotone_in_the_spread(self):
        values = [mkt.spread_to_probability(s) for s in (10, 5, 0, -5, -10)]
        assert values == sorted(values)


class TestScoringRules:
    def test_brier_is_zero_on_a_perfect_call(self):
        assert mkt.brier_score(1.0, True) == 0.0
        assert mkt.brier_score(0.0, False) == 0.0

    def test_brier_of_a_coin_flip(self):
        assert mkt.brier_score(0.5, True) == pytest.approx(0.25)

    def test_brier_is_bounded(self):
        assert mkt.brier_score(0.0, True) == pytest.approx(1.0)

    def test_log_loss_is_finite_at_the_extremes(self):
        # A 0% call on something that happened is infinite log loss in
        # principle; the clamp is what keeps one such row from destroying an
        # entire benchmark.
        assert math.isfinite(mkt.log_loss_single(0.0, True))
        assert math.isfinite(mkt.log_loss_single(1.0, False))

    def test_accuracy_splits_a_dead_heat(self):
        # A .5 forecast is neither right nor wrong; scoring it as either
        # biases the accuracy column of any model that hedges.
        assert mkt.accuracy(0.5, True) == 0.5
        assert mkt.accuracy(0.5, False) == 0.5


class TestValue:
    def test_expected_value_is_zero_at_a_fair_price(self):
        # 2.0 decimal is an even-money bet; a 50% chance has no edge.
        assert mkt.expected_value(0.5, 2.0) == pytest.approx(0.0)

    def test_expected_value_positive_when_the_model_is_higher(self):
        assert mkt.expected_value(0.6, 2.0) > 0

    def test_kelly_is_zero_without_an_edge(self):
        assert mkt.kelly_fraction(0.5, 2.0) == 0.0
        assert mkt.kelly_fraction(0.4, 2.0) == 0.0

    def test_kelly_is_capped(self):
        # An enormous claimed edge must not produce an enormous stake. Full
        # Kelly is growth-optimal only when the probability is exactly right,
        # and the cap is the part that survives the model being wrong.
        stake = mkt.kelly_fraction(0.99, 10.0)
        assert stake <= 0.05

    def test_closing_line_value_sign(self):
        # Taking 2.10 on something that closed at 2.00 is positive CLV.
        assert mkt.closing_line_value(2.10, 2.00) > 0
        assert mkt.closing_line_value(1.90, 2.00) < 0


class TestCalibration:
    def test_empty_buckets_are_omitted(self):
        """A bucket with no members must not be emitted as observed = 0.

        Emitting it draws a reliability curve diving to the floor in bands
        where nothing was ever predicted — a chart that reports a modelling
        failure that did not happen.
        """
        pairs = [(0.9, True)] * 20
        table = mkt.reliability_table(pairs, bins=10)
        assert len(table) == 1
        assert table[0].count == 20

    def test_perfect_calibration_scores_zero_ece(self):
        pairs = [(0.5, i % 2 == 0) for i in range(1000)]
        assert mkt.expected_calibration_error(pairs) == pytest.approx(0.0, abs=1e-9)

    def test_ece_detects_overconfidence(self):
        # Says 90%, happens 50%.
        pairs = [(0.9, i % 2 == 0) for i in range(1000)]
        assert mkt.expected_calibration_error(pairs) == pytest.approx(0.4, abs=0.01)

    def test_summarise_reports_n_and_base_rate(self):
        pairs = [(0.6, True)] * 7 + [(0.6, False)] * 3
        summary = mkt.summarise(pairs)
        assert summary["n"] == 10
        assert summary["base_rate"] == pytest.approx(0.7)
        assert summary["mean_predicted"] == pytest.approx(0.6)
