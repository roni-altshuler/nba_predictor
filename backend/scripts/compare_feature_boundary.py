"""Paired, monthly walk-forward audit of the pre-game season-boundary fix.

Research output only; never overwrites served artifacts. The immutable baseline
source comes from git so later refactors cannot silently change the comparison.
Both fits exclude the entire first test UTC day. Historical feature state still
assumes earlier-starting games finished; this is not prospective validation.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import subprocess
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from backend.scripts.benchmark_market import load_corpus, team_abbreviations
from backend.scripts.experiment_history_window import blocked_interval
from backend.services.prediction.feature_builder import FeatureBuilder, FEATURE_NAMES
from backend.services.prediction.margin_model import MarginModel
from backend.services.prediction import market


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', default='006d8bc')
    parser.add_argument('--out', default='reports/feature_boundary_comparison.json')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    baseline = subprocess.check_output(['git', 'rev-parse', args.baseline], cwd=root, text=True).strip()
    source = subprocess.check_output(['git', 'show', f'{baseline}:backend/services/prediction/feature_builder.py'], cwd=root, text=True)
    module = types.ModuleType('_baseline_features')
    sys.modules[module.__name__] = module
    exec(compile(source, f'{baseline}/feature_builder.py', 'exec'), module.__dict__)
    rows = load_corpus(2003, 2026)
    abbreviations = team_abbreviations()
    old, margins, totals, meta = module.FeatureBuilder(abbreviations=abbreviations).build(rows)
    new, new_margins, new_totals, new_meta = FeatureBuilder(abbreviations=abbreviations).build(rows)
    assert [m['game_id'] for m in meta] == [m['game_id'] for m in new_meta]
    np.testing.assert_array_equal(margins, new_margins)
    np.testing.assert_array_equal(totals, new_totals)
    days = np.array([m['date_utc'][:10] for m in meta], dtype='datetime64[D]')
    months = np.array([m['date_utc'][:7] for m in meta])
    seasons = np.array([m['season'] for m in meta])
    test_mask = (seasons >= 2018) & (seasons <= 2026)
    records = []
    for month in np.unique(months[test_mask]):
        test = np.flatnonzero(test_mask & (months == month))
        train = days < days[test].min()
        predictions = []
        for X in [old, new]:
            model = MarginModel()
            model.fit(X[train], margins[train], totals[train], FEATURE_NAMES, trained_through=str(days[train].max()))
            predictions.append(model.predict(X[test]))
        for i, b, c in zip(test, *predictions):
            records.append({'game_id': meta[i]['game_id'], 'date_utc': meta[i]['date_utc'],
                            'season': meta[i]['season'], 'home_won': bool(margins[i] > 0),
                            'baseline': b.p_home, 'corrected': c.p_home})
    scores = {key: market.summarise([(r[key], r['home_won']) for r in records]) for key in ['baseline', 'corrected']}
    differences = [(r['corrected'] - r['home_won']) ** 2 - (r['baseline'] - r['home_won']) ** 2 for r in records]
    archive = ''.join(json.dumps(r, sort_keys=True) + '\n' for r in records).encode()
    report = {'generated_at': datetime.now(timezone.utc).isoformat(), 'baseline_commit': baseline,
              'baseline_source_sha256': hashlib.sha256(source.encode()).hexdigest(),
              'corrected_source_sha256': hashlib.sha256(Path(__file__).resolve().parents[1].joinpath('services/prediction/feature_builder.py').read_bytes()).hexdigest(),
              'input_sha256': hashlib.sha256(json.dumps([dict(r) for r in rows], sort_keys=True).encode()).hexdigest(),
              'n_input': len(rows), 'n_changed_feature_rows': int(np.any(old != new, axis=1).sum()),
              'n_paired': len(records), 'outer_seasons': [2018, 2026], 'refits': 'monthly; earlier UTC days only',
              'scores': scores, 'delta_brier': blocked_interval(differences, [r['date_utc'] for r in records]),
              'claim': 'Correctness and train/serve parity repair; no demonstrated accuracy gain. Does not evaluate long-range schedule projections.',
              'paired_rows_sha256': hashlib.sha256(archive).hexdigest()}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    with gzip.open(str(out) + 'l.gz', 'wb') as handle:
        handle.write(archive)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
