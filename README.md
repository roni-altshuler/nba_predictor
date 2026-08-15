# Hardwood

Calibrated NBA game and season forecasting, scored against the closing line.

A port of the sibling soccer project ([`soccer_predictor`](https://github.com/roni-altshuler/soccer_predictor)) to basketball. Same architecture, same evidence discipline, same design language — and several of the measured conclusions are the opposite, because basketball is a different sport with different institutions. Those inversions are documented in [CLAUDE.md](CLAUDE.md).

## What it does

1. **Game prediction** — win probability, expected margin, expected total
2. **Season projection** — record, seed distribution, play-in, playoff, conference and championship odds
3. **A value surface** — model probability vs no-vig market price, with EV and Kelly staking
4. **Playoff bracket** — the projected postseason, with every first-round series priced by exact enumeration
5. **The title race** — each conference's contenders as a line that moves as the season is played

The schedule is organised by **NBA week**, and every matchup card opens a
match detail page: the last six meetings, both sides' recent form, the
forecast, and — once the game is played — the full player box score.

Plus a **23-season archive**: final standings, every game with quarters, the
team and player box scores, the playoff bracket, the title race replayed at
ten-day checkpoints, and what the model would have said — labelled a backtest
everywhere it appears, because a reconstructed forecast is not a published
one.

Also: per-team pages with rating history against the league band, and a
head-to-head surface over all 870 ordered matchups.

## Measured state

Corpus: **31,844 games, 2004–2026**, from ESPN. The 2026-27 season tips off **20 October 2026**.

Walk-forward over 25,749 games, refit monthly:

| forecaster | Brier | accuracy | ECE |
|---|---|---|---|
| Margin model | **.2106** | .6645 | .0114 |
| Elo only | .2137 | .6608 | .0436 |
| Constant base rate | .2435 | .5808 | — |

Paired against the closing line on 14,600 priced games:

| forecaster | Brier | gap to close |
|---|---|---|
| Market (closing line) | **.2070** | — |
| Margin model | .2141 | +.0071 |
| Constant base rate | .2444 | +.0374 |

The market wins, significantly (95% CI [+.00573, +.00849]). **That is the intended result** — the model carries no market features, and one that beat the closing line would be evidence of a harness bug rather than an edge. What it does do is close **81%** of the distance from the base rate to the market.

The playoff-series layer does **not** significantly beat "the higher seed advances" on 300 series, and the site says so.

## Quick start

```bash
# Python side
pip install -r requirements.txt
python3 -m backend.scripts.build_warehouse --seasons 2004-2027
python3 -m backend.scripts.backfill_odds --seasons 2004-2026
python3 -m backend.scripts.validate_warehouse_integrity
python3 -m backend.scripts.benchmark_market
python3 -m backend.scripts.forecast_season --sims 20000

python3 -m backend.scripts.build_history
python3 -m backend.scripts.title_race --track

# Frontend
npm install
npm run dev
```

The site is fully static: Next.js reads the published JSON artifacts at build time, so a deploy does not depend on the Python process running.

## Layout

```
backend/
  services/
    data/         warehouse (SQLite) + ESPN loader
    espn/         ESPN API client
    ratings/      Elo, swept not chosen
    prediction/   margin model, market maths, feature builder
    simulation/   Monte Carlo season projection
    playoffs/     best-of-seven enumeration, historical and projected brackets
    forecast/     model versioning
  scripts/        ingest, benchmark, tune, publish, title-race tracking
  tests/          138 tests
  main.py         FastAPI
src/
  app/            Next.js App Router — 12 routes, 5 API routes
  components/     shell, forecast cards, charts, brackets, evidence panel
  lib/            artifact readers, bracket geometry, ESPN box scores, formatters
```

## Design notes

- **The frontend never computes a probability.** It renders published JSON. One place a number is produced.
- **Every probability renders as text**, never colour alone.
- **Absent data renders as absent.** "No line published" and "no edge" are different facts and the UI must not conflate them.
- **The evidence panel is not a tab.** Every percentage on the site is unfalsifiable without it.

## Testing

```bash
python3 -m pytest backend/tests/   # 138 tests
npm test                            # 49 tests
npx next lint && npm run typecheck
```

## Data source

Everything comes from ESPN's public API. Odds are ESPN's `pickcenter` block, which mixes sportsbook prices with public model forecasts — the two are stored separately and only prices are used as the benchmark. See CLAUDE.md for the provider-by-era table.

## Licence

MIT. Nothing here is betting advice.
