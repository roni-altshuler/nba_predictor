"""Nested temporal comparison of bounded history with the current expanding fit.

Run: python -m backend.scripts.experiment_history_window
Research only: never writes serving artifacts. Inner prior-season forecasts select
3-year, 6-year or expanding history; outer seasons measure the selected procedure.
All fits use complete earlier UTC days, with monthly refits and paired week blocks.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import platform
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from backend.scripts.benchmark_market import load_corpus, team_abbreviations
from backend.services.prediction.feature_builder import FeatureBuilder, FEATURE_NAMES
from backend.services.prediction.margin_model import MarginModel
from backend.services.prediction import market as mkt

WINDOWS = (None, 3, 6)


def training_mask(days, cutoff, window):
    mask = days < cutoff
    if window is not None:
        mask &= days >= cutoff - np.timedelta64(round(window * 365.25), 'D')
    return mask


def blocked_interval(differences, dates, iterations=2000, seed=41):
    differences = np.asarray(differences, dtype=float)
    if len(differences) != len(dates) or not len(differences):
        raise ValueError('aligned nonempty paired rows required')
    weeks = [str(datetime.fromisoformat(d[:10]).date() - timedelta(days=datetime.fromisoformat(d[:10]).weekday())) for d in dates]
    _, inverse = np.unique(weeks, return_inverse=True)
    n = int(inverse.max()) + 1
    sums = np.bincount(inverse, weights=differences)
    counts = np.bincount(inverse)
    if n < 2:
        return {'mean_diff': float(differences.mean()), 'ci_low': None, 'ci_high': None, 'blocks': n}
    rng = np.random.default_rng(seed)
    means = []
    for start in range(0, iterations, 64):
        indices = rng.integers(0, n, (min(64, iterations - start), n))
        means.extend((sums[indices].sum(axis=1) / counts[indices].sum(axis=1)).tolist())
    low, high = np.quantile(means, [0.025, 0.975])
    return {'mean_diff': float(differences.mean()), 'ci_low': float(low), 'ci_high': float(high), 'blocks': n, 'iterations': iterations, 'seed': seed, 'unit': 'UTC calendar week'}


def run(rows, abbreviations, first=2018, last=2026):
    X, margins, totals, meta = FeatureBuilder(abbreviations=abbreviations).build(rows)
    days = np.array([m['date_utc'][:10] for m in meta], dtype='datetime64[D]')
    seasons = np.array([m['season'] for m in meta])
    cache = {}

    def predict(season, window):
        key = (season, window)
        if key in cache:
            return cache[key]
        indices = np.flatnonzero(seasons == season)
        out = {}
        # A fit is shared across each month, with zero same-day outcome access.
        months = np.array([meta[i]['date_utc'][:7] for i in indices])
        for month in np.unique(months):
            test = indices[months == month]
            cutoff = days[test].min()
            train = training_mask(days, cutoff, window)
            if train.sum() < 500:
                continue
            model = MarginModel()
            model.fit(X[train], margins[train], totals[train], FEATURE_NAMES,
                      trained_through=str(days[train].max()))
            for i, prediction in zip(test, model.predict(X[test])):
                out[int(i)] = prediction
        cache[key] = out
        return out

    paired, folds = [], []
    for season in range(first, last + 1):
        selections = []
        for window in WINDOWS:
            validation = predict(season - 1, window)
            if not validation:
                raise ValueError(f'No inner validation data for {season - 1}')
            loss = np.mean([(p.p_home - float(margins[i] > 0)) ** 2 for i, p in validation.items()])
            selections.append((float(loss), window))
        chosen = min(selections, key=lambda item: item[0])[1]
        baseline, challenger = predict(season, None), predict(season, chosen)
        if not baseline or baseline.keys() != challenger.keys():
            raise ValueError(f'Missing or unpaired outer fold: {season}')
        fold = []
        for i in sorted(baseline):
            b, c = baseline[i], challenger[i]
            row = dict(meta[i])
            row.update(incumbent=b.p_home, challenger=c.p_home,
                       incumbent_margin=b.exp_margin, challenger_margin=c.exp_margin,
                       incumbent_total=b.exp_total, challenger_total=c.exp_total,
                       selected_window=chosen)
            fold.append(row)
        paired.extend(fold)
        delta = np.mean([(r['challenger'] - r['home_won']) ** 2 - (r['incumbent'] - r['home_won']) ** 2 for r in fold])
        folds.append({'season': season, 'selection_season': season - 1, 'window_years': chosen, 'n': len(fold), 'delta_brier': float(delta),
                      'inner_scores': [{'window_years': w, 'brier': score} for score, w in selections]})
        print(f'{season}: window={chosen}, n={len(fold)}, delta={delta:+.6f}', flush=True)

    scores = {name: mkt.summarise([(r[name], r['home_won']) for r in paired]) for name in ['incumbent', 'challenger']}
    continuous = {name: {target: mkt.summarise_continuous([(r[f'{name}_{target}'], r['home_score'] - r['away_score'] if target == 'margin' else r['home_score'] + r['away_score']) for r in paired]) for target in ['margin', 'total']} for name in scores}
    delta = [(r['challenger'] - r['home_won']) ** 2 - (r['incumbent'] - r['home_won']) ** 2 for r in paired]
    interval = blocked_interval(delta, [r['date_utc'] for r in paired])
    # Paired market context, never used for model fitting or window selection.
    priced = []
    for r in paired:
        if mkt.has_complete_odds(r.get('ml_home'), r.get('ml_away')):
            try:
                priced.append((r, mkt.devig(r['ml_home'], r['ml_away'], 'shin')[0]))
            except mkt.MarketError:
                pass
    market = {'n': len(priced), 'coverage': len(priced) / len(paired), 'method': 'Shin; complete moneylines only'}
    if priced:
        market.update({name: mkt.summarise([(r[name], r['home_won']) for r, _ in priced]) for name in scores})
        market['market'] = mkt.summarise([(p, r['home_won']) for r, p in priced])
    threshold = -0.0005
    passes = interval['ci_high'] is not None and interval['ci_high'] < threshold and all(f['delta_brier'] <= 0.002 for f in folds)
    return {'scores': scores, 'continuous': continuous, 'paired_market': market, 'bootstrap': interval, 'folds': folds,
            'statistical_gate_passed': bool(passes), 'production_eligible': False,
            'gate': {'ci_high_below': threshold, 'max_season_regression': 0.002},
            'verdict': 'research_candidate_requires_prospective_validation' if passes else 'hold_incumbent',
            'limitations': ['Exploratory reuse of previously inspected history; not an untouched final test.',
                           'Local warehouse snapshot; no current production data parity claim.',
                           'Monthly complete-day fits differ from the existing 30-day refit benchmark.',
                           'Historical pre-game features do not validate frozen long-range season forecasts.']}, paired


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--first-season', type=int, default=2018)
    parser.add_argument('--last-season', type=int, default=2026)
    parser.add_argument('--output', default='reports/history_window_experiment.json')
    args = parser.parse_args()
    if args.first_season > args.last_season:
        parser.error('first season must precede last season')
    rows = load_corpus(2004, args.last_season)
    digest = hashlib.sha256(json.dumps([dict(r) for r in rows], sort_keys=True, default=str).encode()).hexdigest()
    report, paired = run(rows, team_abbreviations(), args.first_season, args.last_season)
    report.update(generated_at=datetime.now(timezone.utc).isoformat(), input_sha256=digest,
                  input_games=len(rows), numpy=np.__version__, python=platform.python_version(), feature_names=list(FEATURE_NAMES))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    raw = ''.join(json.dumps(r, allow_nan=False) + '\n' for r in paired).encode()
    archive = output.with_suffix('.jsonl.gz')
    archive.write_bytes(gzip.compress(raw, mtime=0))
    report.update(paired_rows_file=archive.name, paired_rows_sha256=hashlib.sha256(raw).hexdigest())
    output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'scores': report['scores'], 'bootstrap': report['bootstrap'], 'verdict': report['verdict']}, indent=2))


if __name__ == '__main__':
    main()
