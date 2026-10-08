# Hardwood

NBA game and season forecasts, with historical market comparisons.

[Daily slate and matchup browsing](docs/SLATE_BROWSING_2026-10.md) adds shareable
dates and franchise filters, a focused game preview and explicit forecast timing.

A port of the sibling soccer project ([`soccer_predictor`](https://github.com/roni-altshuler/soccer_predictor)) to basketball. Same architecture, same evidence discipline, same design language — and several of the measured conclusions are the opposite, because basketball is a different sport with different institutions. Those inversions are documented in [CLAUDE.md](CLAUDE.md).

## What it does

1. **Game prediction** — win probability, expected margin, expected total
2. **Season projection** — record, seed distribution, play-in, playoff, conference and championship odds
3. **A value surface** — model probability vs no-vig market price, with EV and Kelly staking
4. **Playoff bracket** — the projected postseason, with every first-round series priced by exact enumeration
5. **The title race** — each conference's contenders as a line that moves as the season is played
6. **A live record** — what was published before each tip-off, scored separately from the backtest and never merged with it
7. **In-game win probability** — a second forecaster, scored against ESPN's own curve rather than against the market

The schedule leads with a **daily slate in Eastern time**, with shareable date
and franchise filters that stay in sync through navigation, plus an expandable
weekly calendar. Every game opens
a match detail page: the last six meetings, both sides' recent form, who is
unavailable, the forecast, and — once it is played — the scoring by period,
ESPN's in-game win probability curve, the team totals and the full player box
score. Upcoming previews render on the server without sending the full season's
forecast to the browser; section navigation preserves the return slate, and
failed pages offer a retry that refreshes the server response. Completed playoff
series get their own pages, reachable from any card
on the bracket.

Plus **All-Star weekend**: 31 games over 23 seasons, through every format the
league has tried. Nothing there is forecast, and the page says why.

Plus **`/upsets`**: twenty-three seasons ranked four ways — the lowest
probability given to a team that won, the widest disagreements with the
closing line, the largest comebacks, and the largest margin misses.

Plus a **23-season archive**: final standings, every game with quarters, the
team and player box scores, the playoff bracket, the title race replayed at
ten-day checkpoints, and what the model would have said — labelled a backtest
everywhere it appears, because a reconstructed forecast is not a published
one.

Also: per-team pages with rating history against the league band, and a
head-to-head surface over all 870 ordered matchups.

**Player exploration** starts on a team’s completed games or a game’s box score.
Names and game leaders with usable ESPN athlete IDs open
`/players/espn/[id]?game=[event]&team=[espn-team]`, showing that game’s line,
ESPN game-reported team name, position and jersey when supplied. The normalized
franchise reference is labeled separately, including its modern name in historical
games; an absent game-reported name stays unavailable. The existing ESPN game-summary
reader supplies these details; the committed archive contains team results and
an explicit ESPN team-ID mapping. Player lines are unavailable when that reader
fails. Bare player URLs explain the missing game context. Current rosters,
season averages and career stats remain unavailable. No permitted athlete
portraits are recorded, so names remain visible beside initials/jersey fallbacks.
See the [profile coverage and browser audit](docs/PLAYER_PROFILES_2026-10.md).

**Compare game lines** sits above the player box score in a completed franchise
game. Choose two supplied ESPN athlete IDs, swap the columns, or open either
single-game profile. The dated comparison uses the same summary already read by
the game page; selections survive shared links, reload and browser back/forward.
Reported shooting strings and zeros stay intact, missing cells stay absent, and
DNP rows show their reason without zero-filled stats. The sample is one game per
player, with game-reported team names. No pace adjustment, roster or career
inference is made. Fewer than two usable identities leaves the original box score
available; a source outage retains the existing unavailable state.
See [comparison scope, QA and dependency review](docs/GAME_COMPARISON_2026-10.md).

**Shooting context** adds a team evidence panel to completed and upcoming franchise
games. Select the last 5 or 10 earlier games within the game season or an explicit
prior-season reference. Effective field-goal percentage, three-point attempt
share and free-throw attempts per 100 field-goal attempts compare each team with
its opponents. Rates sum valid counts before division, show metric-specific game
coverage and attempts, and link every included result. The selected game and equal
or later tip-offs are excluded. Missing season files and shooting columns remain
visible. This is reconstructed team context, without pace, roster or opponent
adjustment; it does not change probabilities or estimate player talent, value or
shot quality. See [scope and verification](docs/SHOOTING_CONTEXT_2026-10.md).

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

**Travel, altitude and time-zone shift were built, measured and not shipped.** The altitude effect is real — model residuals are highest at exactly the two arenas above a kilometre, Utah +1.22 points (z = 2.78) and Denver +1.14 (z = 2.71), the top two of thirty — and far too small to move a binary Brier. `ablate_features` puts the whole block inside the noise floor, and a constant feature is not free.

**In-game win probability** is a second forecaster, fitted on 2025 and scored on 2026:

| forecaster | Brier | accuracy |
|---|---|---|
| ESPN's own curve | **.1589** | .7569 |
| This model | .1816 | .7060 |

ESPN wins by .0227 on 250 matched games, and unlike the closing line that is *not* the wanted result — it reads possession and fouls, this reads the clock and the score. Against the two baselines over the full test season it scores .1665, against .2470 for the home base rate and .2071 for the pre-game forecast held flat. Watching the game beats not watching it.

The expected margin and total are scored too, against the spread and the posted total:

| | model MAE | market MAE | gap |
|---|---|---|---|
| margin | 10.04 | 9.88 | +0.31 |
| total | 14.86 | 14.45 | +0.76 |

And the *shape* of the distribution they come from, which matters more — the win probability is the area under that same normal, so its width sets the confidence of every percentage on the site. Realised coverage of the model's own intervals: margin **49.0 / 78.1 / 93.0** against nominal 50/80/95 (slightly narrow, mostly in the tails), total **52.0 / 81.5 / 95.6** (slightly wide).

**The live record is empty**: the season has not started. Every forecast is stamped before its tip-off — to the warehouse and to a committed `forecast_log.json` that survives a warehouse rebuild — and scored from zero, in its own table, never merged with the walk-forward above.

## Courtside and Forecast Lab

The home page now provides an interactive matchup and team following. `/lab` adds
slate and team filters, close-call discovery, shareable matchups, and hypothetical
single-game records, a complete franchise-following panel, bookmarkable filters,
and adjustable model-implied score ranges. Probabilities remain the published model outputs; the page
shows provenance, freshness and links to the measured record.

The [September improvement audit](docs/IMPROVEMENT_AUDIT_2026-09-18.md) documents
implemented history safeguards, coherent score grids and the measured history-window
experiment. The history-window challenger did not pass. Season-opener Elo and
future schedule-load repairs take effect at the next publication; no historical
forecast is rewritten.

```bash
python3 -m backend.scripts.experiment_history_window
python3 -m backend.scripts.compare_feature_boundary
node scripts/courtside_audit.mjs  # running local site, QA_BASE defaults to port 3002
```

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
python3 -m backend.scripts.track_injuries

# Before a season starts, and after any change to the publishing path
python3 -m backend.scripts.rehearse
python3 -m backend.scripts.ablate_features

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
  tests/          backend regression tests
  main.py         FastAPI
src/
  app/            Next.js App Router — 17 routes, 5 API routes, per-game social cards
  components/     shell, forecast cards, charts, brackets, evidence panel
  lib/            artifact readers, bracket geometry, ESPN box scores, formatters
```

## Design notes

- **The frontend never computes a probability.** It renders published JSON. One place a number is produced.
- **Every probability renders as text**, never colour alone.
- **Absent data renders as absent.** "No line published" and "no edge" are different facts and the UI must not conflate them.
- **The evidence panel is not a tab.** Every percentage on the site is unfalsifiable without it.

## Testing

See the [October quality roadmap](docs/QUALITY_ROADMAP_2026-10.md) for the next
model evaluation and browser acceptance criteria.

The daily publisher requires a successful restore of the release warehouse.
Download or decompression failures stop publication and leave the previous
artifacts available. Retry a transient failure; the manual workflow's
`full_rebuild=true` option permits deliberate recovery from scratch after a
failed download. A rebuilt warehouse cannot recover every prior forecast
snapshot, so that option is a recovery decision rather than an automatic retry.
The restore policy is exercised with mocked downloads by
`python -m pytest backend/tests/test_warehouse_restore_workflow.py -q` (requires Bash).

```bash
python3 -m pytest backend/tests/   # backend regression tests
npm test                            # frontend regression tests
npx next lint && npm run typecheck
```

## Data source

Everything comes from ESPN's public API. Odds are ESPN's `pickcenter` block, which mixes sportsbook prices with public model forecasts — the two are stored separately and only prices are used as the benchmark. See CLAUDE.md for the provider-by-era table.

## Licence

MIT. Nothing here is betting advice.
