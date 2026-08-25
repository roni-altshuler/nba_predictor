# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**Hardwood** is an NBA prediction dashboard: Next.js 15 frontend, Python/FastAPI backend, statistical forecasting engine. Deployed on Vercel.

It is a deliberate port of the sibling soccer project (`../soccer_predictor`, "Pitchverse") to basketball. **The architecture, the evidence discipline and the design language are the same on purpose. Several of the measured conclusions are the opposite, also on purpose** — see *Where basketball diverges* below, and do not port a number across sports.

It does **four things**, and nothing else:

1. **Game outcome prediction** — win probability, expected margin, expected total, calibrated and scored against the closing line.
2. **Season projections** — record, seed distribution, play-in, playoff, conference and championship odds, updated as the season runs.
3. **A value surface** — model probability vs no-vig implied probability, with EV and Kelly staking.
4. **Playoff series** — who advances a best-of-seven, and the bracket over them.

If a proposed feature is none of those four, it does not belong here.

## Standing rules — read before changing anything

- **The market is the benchmark.** Any accuracy claim is stated as a paired Brier/log-loss against the closing line on named games, or it is not stated.
- **Calibration gates the product.** No value flag ships on an edge smaller than the measured calibration error. Displayed confidence never exceeds measured confidence.
- **Baselines are never deleted.** Constant base rate, Elo-only, and "the higher seed advances" stay live as yardsticks. A model that cannot beat them does not serve.
- **A regression blocks promotion.** No recording a regression and shipping anyway.
- **No fabricated data.** Sparse coverage stays genuinely missing; never impute a plausible value.
- **Whenever a challenger beats the closing line, suspect the harness first.** A model with no market features cannot out-predict the market. That result is a bug announcing itself.

## Current measured state (2026-08-15)

Corpus: **31,844 games, seasons 2004–2026**, from ESPN. Plus the full 2026-27 schedule (1,206 regular-season games; the season tips off **2026-10-20**).

### Game prediction, walk-forward

Refit monthly, scored on games strictly later than everything it was fitted on. 25,749 games scored after a three-season warm-up.

| forecaster | Brier | log loss | accuracy | ECE |
|---|---|---|---|---|
| Margin model | **.2106** | .6087 | .6645 | .0114 |
| Elo only | .2137 | .6162 | .6608 | .0436 |
| Constant base rate | .2435 | .6800 | .5808 | .0000 |

### Paired against the closing line

14,600 priced games (11,149 unpriced and excluded rather than compared against nothing). Shin de-vig.

| forecaster | Brier | accuracy | ECE | gap to close |
|---|---|---|---|---|
| Market (closing line) | **.2070** | .6763 | .0066 | — |
| Margin model | .2141 | .6575 | .0095 | **+.0071** |
| Elo only | .2165 | .6541 | .0377 | +.0095 |
| Constant base rate | .2444 | .5751 | .0057 | +.0374 |

Paired bootstrap on the difference: **+.00712, 95% CI [+.00573, +.00849], p(model better) = .000.** The market is better, significantly. **That is the expected and wanted result** — the model carries no market features.

The model closes **81%** of the distance from the constant base rate to the market.

### Playoff series

300 resolved series since 2007. Progression check **322/322 = 100%**.

| forecaster | Brier | accuracy | ECE |
|---|---|---|---|
| Coin flip | .2500 | .5000 | .2200 |
| Higher seed advances (base rate) | .2016 | .7200 | .0000 |
| Series model (playoff-fitted) | **.1990** | .7033 | .0749 |

**Nothing here significantly beats "the higher seed advances."** Paired bootstrap vs that baseline: −.00261, 95% CI [−.01807, +.01357] — straddles zero. 300 series is a small corpus and the honest reading is that this layer has **not yet earned a claim**. It ships because its probabilities are what the bracket simulation consumes, and `/accuracy` says so in those words rather than presenting it as a win. Do not quote the .1990 as an edge.

**Live record: none.** The 2026-27 season has not started. `/accuracy` reports the historical walk-forward only, labelled as such.

## Where basketball diverges from soccer — do not port conclusions

This is the most important section in the file. Five conclusions from the sibling project invert here, and each one is measured.

### 1. There are no draws, so the scale is completely different

Overtime resolves every game: **0 ties in 27,690 regular-season games.** Soccer's closing line tops out near 54% on 1X2 because a quarter of matches are drawn; the NBA closing line lands its side **67.6%** of the time and scores a binary Brier of .2070.

**A soccer Brier and an NBA Brier are not comparable numbers.** Soccer's is multiclass over three outcomes; this project's is binary. A .02 gap to the market is respectable there and would be a disaster here. Never put the two in one table.

### 2. Season-boundary regression is REQUIRED here and was REJECTED there

The soccer project tested regression to the mean at the season boundary and rejected it at every level (+.00150 at 0.25, worse at 0.40 and 0.60). Here it is the single most valuable Elo setting, and the result is monotone:

| carryover | Brier |
|---|---|
| 0.60 | **.21488** |
| 0.70 | .21495 |
| 0.75 | .21505 |
| 0.80 | .21520 |
| 0.90 | .21564 |
| 1.00 (no regression) | .21622 |

The reason is institutional rather than statistical: **the NBA drafts in reverse order of finish and caps payrolls; European football does neither.** Its clubs genuinely do stay good.

### 3. Home advantage has collapsed, and is still moving

| era | home win rate | mean margin | rating points |
|---|---|---|---|
| 2004-2009 | .6080 | +3.42 | 76 |
| 2010-2014 | .5989 | +2.98 | 70 |
| 2015-2019 | .5862 | +2.74 | 60 |
| 2020-2023 | .5566 | +1.96 | 40 |
| 2024-2026 | .5493 | +2.00 | **34** |

The served Elo constant is 50 — a compromise across the scoring window, swept as the optimum (and note the ECE column: at 100 rating points the model is five points overconfident, ECE .0558 vs .0073). **Do not treat any single number as "the" home advantage.** The margin model refits monthly and tracks the drift through its intercept.

### 4. Poisson is the wrong shape; margin and total are the right parameters

Dixon-Coles models two goal counts as correlated Poisson draws because soccer scores are small integers. NBA scores average ~110 with variance far below their mean. The model is parameterised on **margin** and **total**:

- margin: mean +2.62, sd 13.82, skew −0.019, excess kurtosis +0.304 — normal is a genuinely good fit
- total: mean 208.72, sd 24.29
- **corr(margin, total) = −0.017** — negligible, so treating them as independent is measured, not assumed

`home = (total + margin) / 2`, `away = (total − margin) / 2`.

**The win probability and the score grid are reconciled by construction**, both read off the same fitted normal. The soccer project had to solve two Poisson lambdas to force this and guards it with a publish-time assertion; here it is an identity, pinned by `test_margin_and_moneyline_are_the_same_number`.

### 5. Same-day rematches are NORMAL, so soccer's duplicate rule would delete real games

The soccer project clusters duplicate fixtures within ±1 day. **Porting that here would silently delete real games**: back-to-back rematches between the same two teams are a standard NBA travel-saving device. The duplicate key is the *same Eastern day*, never a window.

Measured: **zero duplicate fixtures across 23 seasons.** ESPN's event id is a genuinely reliable primary key here — one source, 30 stable franchises, integer team ids. This is the single biggest simplification over the soccer warehouse, which had 2,173 duplicate rows from fuzzy name resolution.

## Known landmines

- **`dates=` filters on US EASTERN local date, not UTC.** The 2026 Finals Game 1 is stamped `2026-06-04T00:30Z` and `dates=20260604` returns nothing for it — it was played the evening of 3 June in New York. Every range fetch overlaps its chunks and de-duplicates on event id. **No code may assume a UTC date maps to an ESPN date**, and the integrity checker buckets on Eastern for the same reason.

- **Train/serve skew, and it shipped once here.** `forecast_season` originally called `predict_from_elo`, which knows only the rating gap, against a 19-feature model — so eighteen features fell back to the intercept and the published expected total was **14.1 points**. It was caught only because a basketball game obviously does not end 6-8. `FeatureBuilder.vector_for` is the serving path and it populates exactly what training populated; `dead_feature_blocks` compares VARIANCE, not names, because the soccer project's version of this bug had matching names and differing values. **Never put a feature in the served vector that the serving path cannot populate.**

- **The offseason regression must be applied explicitly when projecting.** Elo applies carryover lazily, when the first game of a new season arrives — correct while walking a corpus, wrong the moment you stop walking and start projecting. Without `regress_to_season`, the 2026-27 projection ran on end-of-2025-26 ratings and gave New York a **43.2%** title probability against a market that prices no NBA favourite above the mid-20s. Regressed, it is 29.1%. **A forecaster must call it; a backtest must not.**

- **ESPN files the All-Star Game as `season_type=2` (regular season)**, with exhibition sides ("Team Stars", "Team Stripes", "World") and international preseason opponents (Guangzhou Loong-Lions, Melbourne United, Hapoel Jerusalem). They are filtered by **participation** — a franchise is a team with a conference, read from ESPN's standings — never by name. Same rule the soccer project uses to keep the MLS All-Star Game out of a 30-team table.

- **The NBA Cup Championship is a regular-season game that does not count.** ESPN files it under `season_type=2`, so exactly two franchises a season show **83** games. That is correct, not a duplicate; `season_shape` allows +1 for it, and `current_standings` excludes it so a projected record is not shifted by a game the league does not count.

- **Refuse bracket SLOT names at the ingester, not just at the simulator.** ESPN publishes undrawn NBA Cup knockout rounds with both sides named "TBD" — six such fixtures in the 2026-27 schedule. A junk `teams` row is permanent and competes with every later lookup. `is_placeholder` refuses them, and a fixture whose two sides resolve to the same franchise is refused whatever it is called.

- **A postponed game is neither a result nor a fixture.** ESPN keeps the original event forever with `STATUS_POSTPONED` and publishes the makeup under a **new** event id. Filing the original as scheduled leaves a game in the remaining set that will never be played — the 2025-26 season ended with four such rows, each adding a phantom game to every season simulation.

- **`pickcenter` mixes prices and model forecasts, and merging them destroys the benchmark.** `consensus` and named sportsbooks (DraftKings, ESPN BET, Caesars) are **prices**; `numberfire` and `teamrankings` are **public model forecasts**. Market goes to `games.ml_*`; vendors go to `odds_snapshots` under their own name. Coverage by era: none ≤2013, consensus+vendors 2016, **vendors only 2019**, consensus+teamrankings 2023, DraftKings 2026. An unknown provider is logged and skipped, never guessed at.

- **A backfilled line is not a closing line.** Asking ESPN today for a 2016 game returns whatever it kept, with no timestamp saying when it was current. Every backfilled row carries `before_tipoff = 0` and the historical market comparison is labelled retrospective. The forward-captured record is a different thing and the two are never merged.

- **Shin and proportional de-vig are NOT interchangeable at NBA prices.** They agree to ~.003 near even money and diverge to **.0158 at -1000/+650** — larger than the gap between this model and the market. The method is recorded with every benchmark. Shin is the default.

- **Four rows carry corrupt ESPN timestamps** (`401161490`, `401161528`, `401161530`, `401161536`), all in the fortnight before the 2020 suspension: tip-offs at 6-8am ET and venues belonging to a third franchise. They are **kept, not deleted** — each is a genuine, non-duplicate result, and nothing downstream reads venue or time-of-day. Listed explicitly so the count is a baseline: a fifth id means ESPN has a new problem.

- **`games` is results-only.** Every consumer reads a row there as a fact about something that happened. Unplayed games live in `scheduled_games`, and a game must never be in both — `prune_played_from_scheduled` runs in the same pass that files a result.

- **Elo over an unordered stream reads the future and the output looks entirely normal.** `iter_games` orders on `(date_utc, game_id)` and both `EloRatingSystem.run` and `FeatureBuilder.build` raise on an out-of-order row. The soccer project lost a whole benchmark to a split that re-sorted by one key and indexed positionally into another; here metadata is emitted alongside each row so there is no index to get wrong.

- **Season rollover is JULY, not September.** The Finals end in mid-to-late June, so from July the season carrying that label is decided. A September rollover publishes projections for a season already over — complete with 100% playoff probabilities for teams eliminated months ago. `season_bounds` is deliberately wider (September–July, extended to October for the 2020 bubble) and the two must not be collapsed.

- **Vercel escalates ESLint warnings to errors.** Run `npx next lint` before pushing; `npm run build` is not enough.

## The archive, and why every number in it is labelled a backtest

`build_history.py` exports 23 seasons into `backend/data/history/` — final
standings, every game with quarters and box score, the playoff bracket, and
**what the model would have said about each game**.

That last part is the dangerous one. The retrodiction uses the same rolling
walk-forward as `benchmark_market` (refit monthly on games strictly earlier),
so the model never saw the game it scores — but **nobody read those numbers
before those tip-offs either**. `basis: "backtest"` rides on every record,
the UI prints it in the warn colour everywhere it appears, and the game page
says in words that it is a reconstruction rather than a published call. The
sibling soccer project's rule applies verbatim: a reconstructed forecast must
never blur into "published in advance".

The first three seasons carry no forecast at all — they are the warm-up the
model was fitted on, and the game page says so rather than showing a number
that had seen the answer.

**The daily job rebuilds only the season in progress.** Past seasons do not
change, and rewriting 14MB of identical JSON through git every morning is
noise. The full rebuild is weekly, because the retrodictions DO move when the
model changes.

## Frontend surfaces

| route | what it is |
|---|---|
| `/` | today's slate, title odds, power ratings — all named by team mark |
| `/preview` | the preseason projection, plus last season's opening-day one against what happened |
| `/season` | projected standings, the projected-finish chart, the title race |
| `/bracket` | the projected postseason, priced by exact enumeration |
| `/playoffs` | the playoff picture — every team's seed distribution, the play-in band bracketed in amber |
| `/games` | the schedule **by NBA week, as a calendar** |
| `/games/[id]` | one game — upcoming, archived OR All-Star; series history, form, period breakdown, team totals, player box score |
| `/allstar` | All-Star weekend, 31 games over 23 seasons, archive-only |
| `/upsets` | three cross-season boards: biggest upsets, widest disagreements with the market, largest margin misses |
| `/seasons` | the 23-season archive index |
| `/seasons/[season]` | standings, playoff bracket, the title race replayed, the model's five biggest misses |
| `/seasons/[season]/series/[slug]` | one playoff series, game by game |
| `/seasons/[season]/games` | every game that season, by month |
| `/teams/[abbr]` | rating history, seed distribution, next games |
| `/predict` | head-to-head for any two franchises |
| `/ratings` | all 30 power ratings |
| `/accuracy` | the LIVE record first, then the backtest: Brier, calibration, margin/total accuracy, interval coverage and PIT |
| `/about` | how it works |

**The playoff bracket is COMPUTED, not laid out.** `src/lib/bracketLayout.ts`
returns every card position and connector path as arithmetic; the component
absolutely positions from it and draws one `<svg>` underneath. Built from
nested flexbox, whether a card sits on the centre line between the two
feeding it is an emergent property of the box model — it looks about right
and nothing can check it. Here it is a test, on both halves of a mirrored
board.

**The first round has 2^(rounds-1) series, not 2^rounds.** Eight teams per
conference meet in FOUR series. The first version got this off by one and
rendered four empty placeholder cards under every real one.

**Every matchup card is a link, and the destination has to earn it.** A card
that shows a fixture and does nothing when clicked is the most common
complaint any schedule gets, and it was this one's. A game page therefore
carries what a card cannot: the last six meetings, both sides' last ten
results, the records, and after tip-off the full player box score. All of it
comes from `history/game_context.json`, published by `build_history` over the
whole corpus.

**`--from-season` limits which season FILES are rewritten and nothing else.**
`seasons.json` and `game_index.json` are always rebuilt over every season.
The first version filtered the index too — and the daily job runs
`--from-season <current>`, so one scheduled run cut the archive index to a
single season and `game_index` to 1,322 of 29,653 games, turning every other
archived game URL into a 404 while 22 intact season files sat beside it.
Nothing failed; the pages simply stopped existing. `seasons_lost()` now
refuses to publish an index smaller than the live one, the same guard
`forecast_season` applies to franchises.

**A series id cannot go in a URL.** Ids are `2026:1v18` and a colon is
reserved in a path segment: Next prerendered all 345 series routes happily
and then 404'd every one of them at runtime, encoded or not. `seriesSlug()`
drops the season prefix the path already carries, so the URL is
`/seasons/2026/series/1v18`.

**All-Star games are identified by PHASE, and that is the exception to the
participation rule.** "One side is not an NBA franchise" also matches all 120
international exhibitions in the corpus — Real Madrid at Memphis, the
Guangzhou Loong-Lions on tour — which are preseason friendlies. What makes a
game the All-Star Game is that it IS the All-Star Game. They live outside the
model entirely: the sides carry no conference so every franchise filter drops
them, which is correct and is exactly why they need publishing separately.
**No forecast appears on `/allstar`**, deliberately — a rating fitted on
82-game franchises has nothing to say about an untimed race to 40 points.

**The team box score had one row in it for two months.** `_team_box` was
written against the SUMMARY endpoint's stat names (`totalRebounds`,
`fieldGoalsMade-fieldGoalsAttempted`) while the warehouse is built from the
SCOREBOARD, which uses `rebounds` and two separate scalars. Exactly one
column matched — `assists` — so every team-stat column in all 31,844 games
was NULL and nothing failed. The loader now carries both spellings, and the
game page renders team totals from the ESPN summary it already fetches for
the player lines, so the full set is there without a re-ingest. Matching on
`abbreviation` is also forbidden there: `avgRebounds` and `rebounds` share
REB, and the average would overwrite the total.

**Weeks run Monday to Sunday, anchored on `season_start`.** That field is
published in `game_forecasts.json` from the whole season, played and
scheduled — anchoring week 1 on the earliest REMAINING fixture renumbers it
onto whatever is next every morning, which looks right in October and is
nonsense by December.

**A projected bracket is not a bracket with the results missing.** Only the
first round is drawn as matchups, from the modal seeding, with each seed
carrying the probability that team actually lands there. Every later cell
shows the likeliest occupant and its MARGINAL probability of reaching that
round, taken from the simulation. Advancing the modal winner and re-pricing
the next round draws a far more satisfying board and is wrong: it compounds
one seeding assumption four rounds deep and publishes the result as a
championship number. The centre cell prints the same figure the season
projection does, because it is the same figure.

**The title race is one chart drawn from two very different files.**
`title_race_current.json` is LIVE — the daily job appends one point and those
numbers were published in advance. `title_race_<season>.json` is a BACKTEST —
a completed season re-simulated at ten-day checkpoints, each from ratings
built on games strictly earlier than it. The component prints which one it is
drawing; a line chart is unusually good at implying somebody watched it
happen. The replay does **not** call `regress_to_season` — it walks a corpus,
so the Elo system applies its carryover lazily at the boundary, and calling it
would regress twice.

**Charts are validated, not styled.** The dataviz validator was run against
the `#0d0d0d` chart surface; `--viz-model` / `--viz-market` pass all six
checks. The first attempt used `--accent-info` for the market series and
failed two of them — L 0.877 is far outside the band and chroma 0.043 reads
as grey. Tritan separation for the surviving pair is ΔE 5.7, legal only WITH
secondary encoding, so both series are always direct-labelled. See
[docs/DESIGN.md](docs/DESIGN.md).

**Three team lines per conference, because three is what passed.** Re-run with
`--pairs all` (every line is visible at once, so adjacent-only checking misses
the pair a reader confuses), `#5fa657,#3987e5,#c25ba6` passes; every four-hue
set tried failed — green/orange ΔE 4.6 deutan, blue/purple ΔE 2.1 deutan and
13.1 with normal vision. The tail folds into an explicit "field" line, and
because conference-title probabilities sum to one, three named contenders plus
the field is the whole distribution. End labels are nudged apart before
drawing: they are the only channel carrying identity for a colour-blind reader
here, so two on one row means a team disappears.

**Team marks sit on a light plate.** NBA logos are authored for light
backgrounds and several — Brooklyn, San Antonio, Memphis — go invisible on
this site's black canvas. A missing logo falls back to the abbreviation,
never to a broken image.

## Provenance: how a live record becomes possible

**`game_forecasts.json` is a view, not a record.** It is overwritten every
morning, so without something append-only the only evidence of yesterday's
call is that it agrees with today's. A record rebuilt from the corpus after
the fact is a **backtest** by this project's own definition, however careful
the walk-forward is, and no amount of methodology converts one into the
other.

`forecast_season` therefore writes every forecast twice before its tip-off:

1. **`prediction_snapshots`** in the warehouse — every run, so the drift of a
   forecast as tip-off approaches is recoverable. Keyed
   `(fixture_uid, generated_at, model_version)`, so re-running inside one
   second is idempotent and a run an hour later adds an observation.
2. **`backend/data/predictions/forecast_log.json`**, committed to git — the
   FIRST forecast per fixture, never revised.

**The second one exists because the first is not safe.** The warehouse is
gitignored derived data, restored each morning from a release asset, and the
daily job falls back to `build_warehouse --seasons 2004-2027` if that
download fails. Results, prices and ratings all survive that: ESPN still has
them. **A forecast made before a game does not survive anything.** One
transient network failure would otherwise destroy the live record
permanently, the rebuild would succeed, the site would look correct, and
nothing would report the loss.

`score_live` reads both and takes whichever is genuinely earlier — not the
log unconditionally, because taking the later of two pre-tipoff forecasts
weakens the claim silently.

**The earliest pre-tipoff forecast is scored, not the latest.** It is the
hardest version of the claim: furthest from the game, least information, and
impossible to accuse of having crept toward the closing line as it moved.
`generated_at < tipoff_utc` is strict, and a snapshot with no tipoff is
dropped — an unknown tipoff cannot be shown to precede anything.

**The verdict is in the artifact, not in the page.** `score_live` publishes
one of `insufficient` / `market_better` / `indistinguishable` /
`model_better_suspect_the_harness`, and the site prints it. The last one is
not a celebration: a model carrying no market features cannot out-predict the
closing line, so that result is evidence of a harness bug first. It stays
`insufficient` below 30 paired games whatever the numbers look like.

**CLV is the headline on the value surface, not profit.** At a few hundred
bets, realised return is variance with a number attached; whether the price
moved toward us converges in weeks. The price a call was made against is
stored beside the forecast under provider `publish` — not a claim about what
a book showed at that instant, but about what this pipeline read, which is
the only thing it can attest to.

## Margin and total are scored now, and the coverage check is the important one

Every game card publishes an expected margin and an expected total. Until
`evaluate_continuous`, **neither was measured anywhere** — which the standing
rule does not permit: an accuracy claim is stated as a paired measurement on
named games or it is not stated.

Measured over the same 25,749-game walk-forward:

| | model MAE | market MAE | gap | bias |
|---|---|---|---|---|
| margin | 10.04 | 9.88 (spread, n=14,600) | +0.306 | +0.43 |
| total | 14.86 | 14.45 (posted, n=8,218) | +0.760 | −1.53 |

The market wins on both, which is the same story the Brier table tells and
for the same reason.

**Interval coverage is the part with consequences beyond its own table.** The
win probability is not fitted separately — it is the area under the same
fitted normal above zero, and the score grid and every playoff series price
come from it too. So an sd that is too narrow makes *every percentage on the
site* overconfident, by an amount the moneyline ECE only partly reveals.

| nominal | margin | total |
|---|---|---|
| 50% | 49.0% | 52.0% |
| 80% | 78.1% | 81.5% |
| 95% | 93.0% | 95.6% |

**Margin runs narrow; total runs wide.** Both inside two points of nominal,
which is why neither puts a visible bend in the reliability curve — exactly
why they are worth measuring separately. The margin gap is largest in the
tails (93.0% against 95%), which is what the documented excess kurtosis of
+0.304 predicts: a known limit of fitting a normal here, not a surprise.

Note the claim this tests is **not** the one in *Where basketball diverges*
§4. That justifies the normal on the UNCONDITIONAL margin distribution. What
has to hold for the published probabilities is that the FORECAST residual,
standardised by the sd published for that specific game, is standard normal.
The PIT histogram tests its shape; `pit_uniformity` reports chi-square per
degree of freedom and deliberately **no p-value** — at n in the tens of
thousands any real model fails a goodness-of-fit test on some decimal place,
and `p < .001` beside a visibly flat histogram would be true and completely
misleading.

## The upset boards are a sort, not a computation

`build_upsets` ranks 25,749 already-stored retrodictions three ways. Nothing
new is computed; the archive simply had no way to look across seasons, so the
biggest upsets in twenty-three years were computed and invisible.

**`p_model` is a HOME probability and orienting it is the whole trap.** An
away upset is a low probability for the away side, which is a *high*
`p_model` — sorting on it directly puts every home favourite's loss at the
top and every away favourite's loss at the bottom, and the board looks
entirely plausible. There is a test on it, and the fixtures for a *different*
test in the same file were written backwards on the first attempt.

The disagreement board leads with the **full-corpus** split (model closer on
6,282 of 14,600, or 43.0%), not with the top-100 slice. A board sorted by
disagreement is selected on exactly the games where one side was furthest out
on a limb, which is not a fair test of either — both numbers are published so
the page can say which is which.

Warm-up seasons carry no forecast and appear on no board. A missing
`p_model` treated as zero would make every warm-up game the biggest upset in
history.

## Measured and NOT shipped: travel, altitude, time zone

`teams.venue_lat`, `venue_lon` and `venue_altitude_m` had been in the schema
and NULL for all thirty franchises since the day it was written. They are
populated now — from `services/data/arenas.py`, a reference table, because
ESPN publishes a venue name and a city and no coordinates.

Four features were built on them and **measured out of the served vector**.
`ablate_features` over the same 25,749-game walk-forward:

| block | Brier | delta | verdict |
|---|---|---|---|
| rest | .211040 | **+.000421** | earns its place |
| form | .210677 | +.000057 | no measurable effect |
| timezone | .210642 | +.000022 | no measurable effect |
| elo_levels | .210641 | +.000021 | no measurable effect |
| altitude | .210620 | ±.000000 | no measurable effect |
| pace | .210620 | ±.000000 | no measurable effect |
| travel | .210576 | −.000044 | slightly better without it |

Delta is *ablated minus full*, so positive means removing it hurt. The noise
floor is about ±.0004 at this n.

**The altitude effect is real and too small to matter, which are different
claims and both are true.** Residuals from the published model are highest at
exactly the two arenas above a kilometre — Utah +1.22 points against the
league mean (z = 2.78) and Denver +1.14 (z = 2.71), the top two of thirty.
But 1.2 points of margin is about two points of win probability, at the 7% of
games played in those two buildings, which lands in the fifth decimal of a
binary Brier. Elo has already absorbed most of it besides: a team that wins
more at home carries a higher rating.

**The uncomfortable half of that table is that almost nothing else earns its
place either.** Rest is the only block above the noise floor; form spends
seven features for +.00006. That is a finding about the whole feature set and
it is recorded rather than acted on — "no evidence of help" is not "evidence
of harm", and dropping seven live features on one ablation would be exactly
the unmeasured change this table exists to prevent.

## The rehearsal found the rest features are dead at serve time

`rehearse` stands the real publishing code at seven points in a completed
season and checks 15 invariants at each. All 105 pass — and the run surfaced
something no unit test could:

**`home_b2b`, `away_b2b` and the rest block are constant in the served
vector for every game except the imminent ones.** `vector_for` computes rest
from `TeamState.last_game`, which is the last game a team actually PLAYED. For
a fixture three weeks out that gap is enormous, rest clips to `MAX_REST_DAYS`
for both sides, and every back-to-back flag reads 0.

So the one feature block the ablation says earns its place is **not being
served** for most of the season's forecasts. `dead_feature_blocks` has been
reporting it correctly on every run; it was read as the known preseason case
(nobody has played, so of course rest is constant) and it is not only that.

The fix is that the serving path must compute rest from the SCHEDULE rather
than from results, which means `vector_for` needs to know the fixture list.
Not done here. It is the highest-value known improvement in the repo, it is
measured, and it should be taken as a piece of work on its own.

## In-game win probability

A second forecaster, and the first one here whose baseline is not the market.
Fitted on 2025, scored on 2026, split by whole season — splitting states at
random would put a game's third quarter in training and its fourth in test.

    logit P(home) = b0 + b1·(lead/√f) + b2·lead + b3·f

`f` is the fraction of regulation left. `lead/√f` is a **standardised lead**:
the same diffusion the pre-game model already assumes, since a margin that is
normal at full time is normal at any fraction of it with sd scaling as √f.
This is not an analogy to `margin_sd`; it is the same object at `f = 1`.

Overtime is fitted separately. Clamping `f` to a small positive number would
tell the model that a two-point lead in overtime is as decisive as a
two-point lead with four seconds left in regulation.

| forecaster | Brier | accuracy | ECE |
|---|---|---|---|
| ESPN's own curve | **.1589** | .7569 | .0295 |
| This model | .1816 | .7060 | .0364 |

on 250 matched test games. **ESPN wins by .0227**, and unlike the closing
line that is not the wanted result — ESPN reads possession, fouls and
timeouts, and this reads the clock and the score. It is a gap worth closing
rather than a gap that should exist.

Against the two baselines on the full test season (1,326 games, 438,822
states): the live model scores .1665, the home base rate .2470, and the
pre-game forecast held flat for the whole game .2071. **Watching the game
beats not watching it**, which is the only claim this layer has actually
earned so far.

Brier by period: Q1 .2315, Q2 .1942, Q3 .1499, Q4 .0928, last two minutes
.0475. A pooled number hides all of that — almost every state in a game is in
the easy middle.

**Matching to ESPN is approximate and says so.** ESPN publishes one row per
play; the ingest stores one row per distinct (clock, score) state, having
deduplicated the rebound that shares a timestamp with the shot before it. The
two sequences are matched on fraction-through, not by index — an index join
would compare our 200th state to ESPN's 240th play and look perfectly fine.

## Architecture

### Backend (`backend/`)

- **`services/data/`** — `warehouse.py` (SQLite, gitignored), `espn_loader.py`. Team identity is ESPN's integer id; there is **no fuzzy resolver** and there does not need to be.
- **`services/espn/`** — `client.py`. Host is `site.web.api.espn.com`, **never** `site.api` (Akamai answers datacentre IPs with 403 and no CORS headers). Named once here and once in `src/lib/espnHost.ts`.
- **`services/ratings/elo.py`** — Elo with an MOV multiplier and an autocorrelation correction. Swept, not chosen.
- **`services/prediction/`** — `margin_model.py` (the served forecaster), `market.py` (de-vig, scoring rules, EV, Kelly), `feature_builder.py` (19 features, structurally point-in-time).
- **`services/simulation/season_simulator.py`** — Monte Carlo, one correlated strength offset per team per season.
- **`services/playoffs/series.py`** — exact best-of-seven enumeration, home-court patterns, depth by counting.
- **`services/playoffs/projection.py`** — the forward-looking twin: modal seeding by greedy assignment, first-round series priced with the simulator's OWN game probability (passed in, never reimplemented).
- **`main.py`** — FastAPI, serving the same artifacts the frontend reads.

### Frontend (`src/`)

Next.js 15 App Router, 6 pages, 5 API routes. **The frontend never computes a probability** — it reads published JSON. A component that recomputes something is a second model nobody benchmarked.

Design language is **Bugatti**, ported from the sibling projects: pure black `#000`, surfaces `#0d0d0d`/`#141414`, hairlines `#262626`, white uppercase letterspaced display, monospace for nav/buttons/tables. **No gradients, no shadows, no glassmorphism on components.** Colour on content carries meaning only. The one decorative exception is the **ambient hardwood layer** (`AmbientBackground.tsx`, owner-sanctioned 2026-08-25): faint court lines + two slow ember glows behind everything, capped near 7% opacity, negative z-index, `animation: none` under reduced motion — see docs/DESIGN.md §6 for its guardrails before touching it.

**Dark-only.** `<html class="dark">` is hardcoded, `:root` is the single source of truth, `.dark` is intentionally empty.

### Conventions

- **CSS variables, never Tailwind colours** — `text-[var(--text-primary)]`, not `text-gray-400`.
- **Every probability renders as text**, never colour-only.
- **Absent data renders as absent**, never as zero. "No line published" and "no edge" are different facts.
- Backend tests use absolute imports (`from backend.services...`); root `conftest.py` makes that work.

## Common commands

| Task | Command |
|---|---|
| Build/refresh the warehouse | `python3 -m backend.scripts.build_warehouse --seasons 2004-2027` |
| Refresh the current season | `python3 -m backend.scripts.build_warehouse --current-season` |
| Backfill odds | `python3 -m backend.scripts.backfill_odds --missing-only` |
| **Integrity check (run after any ingest change)** | `python3 -m backend.scripts.validate_warehouse_integrity` |
| Market benchmark | `python3 -m backend.scripts.benchmark_market` |
| Elo sweep | `python3 -m backend.scripts.tune_elo` |
| Playoff series backtest | `python3 -m backend.scripts.benchmark_series` |
| Publish the forecast | `python3 -m backend.scripts.forecast_season --sims 20000` |
| **Score the live record** | `python3 -m backend.scripts.score_live` |
| **Record today's injuries** | `python3 -m backend.scripts.track_injuries` |
| **Dress-rehearse the daily job** | `python3 -m backend.scripts.rehearse` |
| **Does a feature earn its place** | `python3 -m backend.scripts.ablate_features` |
| Ingest play-by-play states | `python3 -m backend.scripts.build_winprob --seasons 2025-2026` |
| Score the live win probability | `python3 -m backend.scripts.benchmark_winprob --espn-sample 250` |
| Export the season archive | `python3 -m backend.scripts.build_history` |
| Refresh only the current season's file | `python3 -m backend.scripts.build_history --from-season 2027` |
| Append today's title-race point | `python3 -m backend.scripts.title_race --track` |
| Replay a season's title race | `python3 -m backend.scripts.title_race --replay 2026 --every 10 --sims 4000` |
| Regenerate icons | `npm run icons` |
| Screenshot every route | `node scripts/shoot.mjs` |
| Backend tests | `python3 -m pytest backend/tests/` |
| Frontend tests | `npm test` |
| Lint (Vercel hard gate) | `npx next lint` |
| Dev server | `npm run dev` |

## What is genuinely missing

Recorded rather than papered over:

- **No injury or roster data IN THE MODEL.** The model knows nothing about trades, the draft, or who is playing. This is still the largest single gap and it is why preseason title odds stay more concentrated than a real futures market. Availability is now *shown* on an upcoming game page from ESPN's injuries endpoint, with an explicit statement that the forecast beside it has not read it. It is deliberately not folded into a rating: **ESPN publishes injuries as a snapshot of today with no historical archive**, so an availability-adjusted model cannot be walk-forward tested against this corpus at all — it could only be validated forward, from zero, over years. This project does not publish a number it cannot benchmark.
- **No live win probability of our own.** ESPN's `winprobability` curve is now rendered on an archived game page, labelled as ESPN's — a different model reading time, score and possession, none of which this forecaster has. Computing our own is a separate project and must not be confused with displaying theirs.
- **No player-level anything in the MODEL.** `/games/[id]` renders full player box scores, but they are fetched from ESPN at request time and cached for a day — deliberately not in the warehouse, which holds only what the model consumes. 31,844 games of player lines is hundreds of megabytes of JSON that no forecast reads. Nothing player-level feeds a probability.
- **Title-race replays exist for 2024, 2025 and 2026 only.** Each is ~2 minutes of compute and past seasons never change, so they are generated on demand rather than in a workflow. Add one with `title_race --replay <season>`.
- **Odds coverage is uneven by era** — see the provider table above. 2019 has no market at all.
- **The live published record is empty** because the season has not started. It will grow from zero and be reported at whatever n it reaches, never merged with the historical walk-forward. The machinery is in place and tested — see *Provenance* below.
