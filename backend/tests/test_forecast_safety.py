import json
from datetime import datetime

import numpy as np
import pytest

from backend.services.forecast.history import read_history, utc
from backend.scripts.forecast_season import append_forecast_log
from backend.scripts.experiment_history_window import training_mask, blocked_interval


@pytest.mark.parametrize('content', ['{', '[]', '{}', '{"forecasts": []}', '{"forecasts": {"x": null}}', '{"forecasts": {}, "n": 1}'])
def test_corrupt_history_cannot_be_replaced(tmp_path, content):
    path = tmp_path / 'log.json'
    path.write_text(content)
    with pytest.raises(ValueError):
        append_forecast_log(path, [], season=2027, generated_at='2026-09-18T00:00:00Z', version='test')
    assert path.read_text() == content


def test_timezone_offsets_compare_instants_not_strings(tmp_path):
    game = {'game_id': 'g', 'date_utc': '2026-10-20T20:00:00Z',
            'home': {'abbreviation': 'BOS'}, 'away': {'abbreviation': 'DET'}, 'p_home': .6}
    assert append_forecast_log(tmp_path / 'log.json', [game], season=2027,
                               generated_at='2026-10-20T17:00:00-04:00', version='v') == 0
    assert append_forecast_log(tmp_path / 'log.json', [game], season=2027,
                               generated_at='2026-10-20T21:00:00+02:00', version='v') == 1


def test_naive_time_is_not_provable_utc():
    with pytest.raises(ValueError, match='timezone'):
        utc('2026-10-20T17:00:00')


def test_fit_mask_excludes_entire_test_day_and_future():
    dates = np.array(['2020-01-01', '2024-01-01', '2026-01-01', '2026-01-02'], dtype='datetime64[D]')
    cutoff = np.datetime64('2026-01-01')
    assert training_mask(dates, cutoff, None).tolist() == [True, True, False, False]
    assert training_mask(dates, cutoff, 3).tolist() == [False, True, False, False]


def test_week_bootstrap_preserves_game_weight_with_uneven_clusters():
    differences = [-.02, -.02, -.02, .04]
    dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-12']
    result = blocked_interval(differences, dates, iterations=128)
    assert result['mean_diff'] == pytest.approx(-.005)
    assert result['blocks'] == 2
    assert result == blocked_interval(differences, dates, iterations=128)
    assert result['ci_low'] <= result['mean_diff'] <= result['ci_high']


@pytest.mark.parametrize('margin,total', [(0, 220), (25, 190), (-30, 260)])
def test_score_grid_has_no_ties_and_preserves_moneyline_on_truncated_ranges(margin, total):
    from backend.services.prediction.margin_model import MarginModel
    forecast = MarginModel().forecast_from(margin, total)
    grid, _, _ = forecast.score_grid(low=95, high=125)
    assert np.trace(grid) == 0
    assert grid.sum() == pytest.approx(1)
    assert np.tril(grid, -1).sum() == pytest.approx(forecast.p_home)
    assert np.triu(grid, 1).sum() == pytest.approx(forecast.p_away)


def test_score_grid_uses_the_fitted_correlation():
    from backend.services.prediction.margin_model import MarginModel
    forecast = MarginModel().forecast_from(5, 225)
    independent, _, _ = forecast.score_grid()
    forecast.margin_total_corr = .5
    correlated, _, _ = forecast.score_grid()
    assert not np.allclose(independent, correlated)
    assert np.tril(correlated, -1).sum() == pytest.approx(forecast.p_home)


def test_score_grid_rejects_unrepresentable_domain():
    from backend.services.prediction.margin_model import MarginModel
    with pytest.raises(ValueError):
        MarginModel().forecast_from(0, 220).score_grid(low=100, high=100)


def test_bad_history_stops_publisher_before_loading_warehouse(tmp_path, monkeypatch):
    from backend.scripts import forecast_season
    (tmp_path / 'forecast_log.json').write_text('{broken')
    called = []
    monkeypatch.setattr(forecast_season, 'get_warehouse', lambda: called.append(True))
    with pytest.raises(ValueError, match='forecast history'):
        forecast_season.main(['--out-dir', str(tmp_path)])
    assert called == []


def test_live_scores_keep_model_versions_and_horizons_separate():
    from backend.scripts.score_live import evaluate
    records = [
        {'p_home': .7, 'home_won': True, 'exp_margin': None, 'exp_total': None,
         'tipoff_utc': '2026-10-20T20:00:00Z', 'lead_hours': hours, 'model_version': version}
        for version, hours in [('a', 10), ('a', 200), ('b', 10)]
    ]
    report = evaluate(records)
    assert report['n'] == 3
    assert {(r['model_version'], r['horizon'], r['n']) for r in report['cohorts']} == {
        ('a', 'under_24h', 1), ('a', 'over_7_days', 1), ('b', 'under_24h', 1)}


@pytest.mark.parametrize('served_flag', [0, 1])
def test_homogeneous_slate_exempts_only_correct_context_flags(caplog, monkeypatch, served_flag):
    from backend.scripts.forecast_season import forecast_games
    from backend.services.prediction.feature_builder import FeatureBuilder, FEATURE_NAMES
    from backend.services.prediction.margin_model import MarginModel
    builder = FeatureBuilder()
    vectors = np.zeros((1, len(FEATURE_NAMES)))
    vectors[0, FEATURE_NAMES.index('is_playoff')] = served_flag
    monkeypatch.setattr(builder, 'vectors_for_schedule', lambda games: vectors)
    train_X = np.zeros((2, len(FEATURE_NAMES)))
    train_X[1, FEATURE_NAMES.index('is_playoff')] = 1
    model = MarginModel()
    monkeypatch.setattr(model, 'predict', lambda X: [model.forecast_from(3, 220)])
    teams = {i: {'name': str(i), 'abbreviation': str(i), 'conference': 'East', 'logo': None} for i in [1, 2]}
    game = {'game_id': 'g', 'date_utc': '2026-10-20T20:00:00Z', 'season_type': 2,
            'home_team_id': 1, 'away_team_id': 2, 'neutral_site': False, 'venue': None,
            'ml_home': None, 'ml_away': None}
    forecast_games(model, builder, [game], teams, train_X)
    assert ('TRAIN/SERVE SKEW' in caplog.text) == bool(served_flag)
