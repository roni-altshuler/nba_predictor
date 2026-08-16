# Hardwood

Calibrated NBA game and season forecasting, scored against the closing line.

A port of the sibling soccer project ([`soccer_predictor`](https://github.com/roni-altshuler/soccer_predictor)) to basketball. Same architecture, same evidence discipline, same design language — and several of the measured conclusions are the opposite, because basketball is a different sport with different institutions. Those inversions are documented in [CLAUDE.md](CLAUDE.md).

## What it does

1. **Game prediction** — win probability, expected margin, expected total
2. **Season projection** — record, seed distribution, play-in, playoff, conference and championship odds
3. **A value surface** — model probability vs no-vig market price, with EV and Kelly staking
4. **Playoff bracket** — the projected postseason, with every first-round series priced by exact enumeration
5. **The title race** — each conference's contenders as a line that moves as the season is played
6. **A live record** — what was published before each tip-off, scored separately from the backtest and never merged with it

The schedule is a **calendar, one NBA week at a time**, and every game opens
a match detail page: the last six meetings, both sides' recent form, who is
unavailable, the forecast, and — once it is played — the scoring by period,
ESPN's in-game win probability curve, the team totals and the full player box
score. Completed playoff series get their own pages, reachable from any card
on the bracket.

Plus **All-Star weekend**: 31 games over 23 seasons, through every format the
league has tried. Nothing there is forecast, and the page says why.

Plus **`/upsets`**: twenty-three seasons ranked by how wrong somebody was —
the lowest probability given to a team that won, the widest disagreements with
the closing line, and the largest margin misses.

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

The expected margin and total are scored too, against the spread and the posted total:

| | model MAE | market MAE | gap |
|---|---|---|---|
| margin | 10.04 | 9.88 | +0.31 |
| total | 14.86 | 14.45 | +0.76 |

And the *shape* of the distribution they come from, which matters more — the win probability is the area under that same normal, so its width sets the confidence of every percentage on the site. Realised coverage of the model's own intervals: margin **49.0 / 78.1 / 93.0** against nominal 50/80/95 (slightly narrow, mostly in the tails), total **52.0 / 81.5 / 95.6** (slightly wide).

**The live record is empty**: the season has not started. Every forecast is stamped before its tip-off — to the warehouse and to a committed `forecast_log.json` that survives a warehouse rebuild — and scored from zero, in its own table, never merged with the walk-forward above.

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
python3 -m backend.scripts.score_live

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
  tests/          224 tests
  main.py         FastAPI
src/
  app/            Next.js App Router — 17 routes, 5 API routes
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
python3 -m pytest backend/tests/   # 224 tests
npm test                            # 94 tests
npx next lint && npm run typecheck
```

## Data source

Everything comes from ESPN's public API. Odds are ESPN's `pickcenter` block, which mixes sportsbook prices with public model forecasts — the two are stored separately and only prices are used as the benchmark. See CLAUDE.md for the provider-by-era table.

## Licence

MIT. Nothing here is betting advice.
