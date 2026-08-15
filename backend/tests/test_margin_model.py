"""The margin/total model.

The first test in this file is the most important one in the project: it
pins that the moneyline and the score distribution are the SAME number
rather than two numbers that happen to be close.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.services.prediction.margin_model import (
    CONTINUITY,
    MarginModel,
    MarginModelParams,
)


def _fitted_model(n: int = 2000, seed: int = 7) -> MarginModel:
    rng = np.random.default_rng(seed)
    elo_diff = rng.normal(0, 150, n)
    pace = rng.normal(200, 12, n)
    X = np.column_stack([elo_diff, pace])
    margins = elo_diff / 28.0 + 2.5 + rng.normal(0, 13.0, n)
    totals = pace * 1.05 + rng.normal(0, 15.0, n)
    model = MarginModel()
    model.fit(X, margins, totals, ["elo_diff", "pace"])
    return model


class TestReconciliation:
    def test_margin_and_moneyline_are_the_same_number(self):
        """P(home) must equal the home-wins mass of the score grid.

        In the sibling soccer project this required solving two Poisson
        lambdas so a scoreline grid would reproduce the measured-best 1X2,
        and it is guarded there by a publish-time assertion. Here it is an
        identity — both come off the same fitted normal — and this test
        exists so it STAYS one. A future change that computes the win
        probability separately would make the card contradict itself.
        """
        model = MarginModel(MarginModelParams(margin_sd=13.0, total_sd=18.0))
        forecast = model.forecast_from(6.0, 220.0)

        # The grid is over per-team scores, so it must span the range a
        # SINGLE team scores (~110), not the range of a total. Asking for
        # 140-300 per team describes games totalling 280-600 and reports
        # nonsense — which is exactly what the first version of this test
        # did, and it read as a reconciliation failure rather than as a
        # badly chosen window.
        low, high = 60, 180
        grid, _, _ = forecast.score_grid(low=low, high=high)
        home = np.arange(low, high + 1)[:, None]
        away = np.arange(low, high + 1)[None, :]
        home_wins_mass = float(grid[(home - away) > 0].sum())

        assert home_wins_mass == pytest.approx(forecast.p_home, abs=0.02)

    def test_probabilities_sum_to_one(self):
        model = MarginModel()
        forecast = model.forecast_from(3.0, 220.0)
        assert forecast.p_home + forecast.p_away == pytest.approx(1.0)

    def test_scores_recover_the_margin_and_total(self):
        model = MarginModel()
        forecast = model.forecast_from(7.5, 224.0)
        assert forecast.exp_home_score - forecast.exp_away_score == pytest.approx(7.5)
        assert forecast.exp_home_score + forecast.exp_away_score == pytest.approx(224.0)


class TestNoTies:
    def test_a_zero_margin_is_not_a_coin_flip(self):
        """Overtime resolves every NBA game, so P(margin = 0) is zero.

        The half-point continuity correction is what makes a discrete margin
        consistent with a continuous normal. Without it a 0.0 expected margin
        would return exactly .5, which ignores that a game must be decided.
        """
        model = MarginModel(MarginModelParams(margin_sd=13.0))
        forecast = model.forecast_from(0.0, 220.0)
        assert forecast.p_home < 0.5
        assert forecast.p_home == pytest.approx(0.485, abs=0.005)

    def test_continuity_correction_is_half_a_point(self):
        assert CONTINUITY == 0.5


class TestFit:
    def test_recovers_a_known_relationship(self):
        model = _fitted_model()
        # Data was generated with margin = elo_diff / 28 + 2.5, so the
        # fitted coefficient on elo_diff should land near 1/28.
        assert model._margin_coef[1] == pytest.approx(1 / 28.0, rel=0.1)

    def test_residual_sd_is_recovered(self):
        model = _fitted_model()
        assert model.params.margin_sd == pytest.approx(13.0, rel=0.1)
        assert model.params.total_sd == pytest.approx(15.0, rel=0.15)

    def test_refuses_a_corpus_too_small_to_fit(self):
        X = np.zeros((10, 2))
        with pytest.raises(ValueError, match="not a corpus"):
            MarginModel().fit(X, np.zeros(10), np.zeros(10), ["a", "b"])

    def test_intercept_is_not_penalised(self):
        """A heavy ridge must not shrink the league's mean margin to zero.

        Tested on the MEAN PREDICTION rather than on the raw intercept: the
        design matrix is uncentred (pace averages ~200), so the intercept
        coefficient is not the mean margin and asserting on it directly
        tests arithmetic rather than the property. What matters is that
        home advantage survives the penalty.
        """
        rng = np.random.default_rng(11)
        n = 2000
        elo_diff = rng.normal(0, 150, n)
        pace = rng.normal(200, 12, n)
        X = np.column_stack([elo_diff, pace])
        margins = elo_diff / 28.0 + 2.5 + rng.normal(0, 13.0, n)
        totals = pace * 1.05 + rng.normal(0, 15.0, n)

        heavy = MarginModel()
        heavy.fit(X, margins, totals, ["elo_diff", "pace"], ridge=1e6)
        predicted = np.array([f.exp_margin for f in heavy.predict(X)])
        assert predicted.mean() == pytest.approx(margins.mean(), abs=0.2)
        assert predicted.mean() > 1.5

    def test_predict_requires_a_fit(self):
        with pytest.raises(RuntimeError, match="not fitted"):
            MarginModel().predict(np.zeros((1, 2)))


class TestMonotonicity:
    def test_a_bigger_edge_is_a_bigger_probability(self):
        model = MarginModel()
        probabilities = [model.forecast_from(m, 220.0).p_home for m in (-10, -5, 0, 5, 10)]
        assert probabilities == sorted(probabilities)

    def test_cover_probability_respects_the_spread(self):
        model = MarginModel()
        forecast = model.forecast_from(6.0, 220.0)
        # Laying 10 is harder to cover than laying 2.
        assert forecast.cover_probability(-10.0) < forecast.cover_probability(-2.0)

    def test_cover_at_the_projected_margin_is_a_coin_flip(self):
        model = MarginModel()
        forecast = model.forecast_from(6.0, 220.0)
        assert forecast.cover_probability(-6.0) == pytest.approx(0.5, abs=1e-6)

    def test_over_probability_respects_the_line(self):
        model = MarginModel()
        forecast = model.forecast_from(3.0, 220.0)
        assert forecast.over_probability(210.0) > forecast.over_probability(230.0)
        assert forecast.over_probability(220.0) == pytest.approx(0.5, abs=1e-6)


class TestPersistence:
    def test_round_trips_through_disk(self, tmp_path):
        model = _fitted_model()
        before = model.predict(np.array([[100.0, 205.0]]))[0]
        path = model.save(tmp_path / "model.json")
        restored = MarginModel.load(path)
        after = restored.predict(np.array([[100.0, 205.0]]))[0]
        assert after.p_home == pytest.approx(before.p_home)
        assert after.exp_total == pytest.approx(before.exp_total)

    def test_save_is_atomic(self, tmp_path):
        """A crash mid-write must leave the previous artifact serving."""
        path = tmp_path / "model.json"
        _fitted_model().save(path)
        assert path.exists()
        assert not path.with_suffix(".json.tmp").exists()
