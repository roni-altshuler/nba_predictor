# Hardwood: fan experience and forecast reliability

Inspected 18 September 2026 after fetching all remotes and fast-forwarding seven
commits from `fce3243` to `006d8bc`. Implemented on `codex/hardwood-forecast-lab` and prepared for the requested delivery to `main`.
This applies the scope of the soccer improvement work to NBA-specific evidence.
The model family is unchanged. Correctness repairs apply on the next forecast publication; existing forecast history is preserved.

## What the current evidence supports

The committed September 14 benchmark evaluates 25,749 historical games with the
margin model at binary Brier **0.210604**, log loss **0.608671**, accuracy
**66.449%**. On the **14,600 paired priced games**, model Brier is **0.214107**
and market Brier **0.206988**. The reported model-minus-market difference is
**+0.00712**, interval **[+0.00573, +0.00849]**. Lower Brier is better.
The September 17 live artifact has **zero settled forecasts**. Historical
performance is not a prospective result; no new accuracy claim follows from UI
work. NBA binary Brier scores cannot be compared directly with soccer 1X2 scores.

The current forecast contains 1,200 remaining games, with no two-sided market
prices. Missing prices should remain missing, never turn into a zero edge.
The model's 95% historical margin interval covers 93.02% of outcomes: calibration
of the full score distribution deserves attention alongside winner accuracy.

## Implemented experience

- **Courtside on the home page:** a selected matchup with official team marks,
  published win probabilities, expected scores/margin/total, a selectable slate,
  team filters and following, and direct links into game, season and bracket views.
- **`/lab`:** the complete published schedule, close-call filtering (both teams
  40–60%), shareable matchups, persistent following by canonical warehouse team ID,
  and explicit one-game hypothetical win/loss record changes. These scenarios do
  not recompute title or playoff probabilities and are not season simulations.
- **Read the evidence alongside the experience:** explicit pre-game labels,
  publication time, model version, optional training cutoff, a 48-hour freshness
  notice, model limitations and a link to the measured record. Live scores remain
  in the existing scoreboard; a pre-game probability is never relabelled live.
- **Resilient interaction:** failed refreshes preserve existing forecasts, a
  ten-second timeout exposes retry copy, malformed or duplicated forecast rows are
  withheld, completed games leave the explorer, and missing shared games explain
  why they are unavailable. Following works during the visit if storage is blocked.
- **Time and loading:** Eastern slate grouping now uses `America/New_York`, including
  daylight saving, rather than a fixed five-hour subtraction. The week anchor uses
  the same timezone. Home serialises only seven slates. Native fonts remove network
  font downloads from the build; the typography keeps its sans/monospace split.
- **Reduced motion:** page transitions retain the same DOM structure on server and
  client and use a CSS media query to disable animation.

Forecasts come from the committed artifact and update when the publishing/deployment
pipeline produces a new artifact. Refresh does not retrain the model or guarantee
new data. There is no invented fan polling, synthetic injury adjustment or LLM
probability calculation.

## Implemented modeling and publication controls

1. **History fails closed.** A missing first history file is allowed. Invalid JSON,
   unreadable files, wrong record structures, and mismatched counts stop publication
   and scoring. The publisher checks history before training or changing served
   files and appends history before overwriting forecast views. Individual artifact
   writes remain atomic; the entire multi-file publication is not transactional.
2. **Compare instants, not timestamp strings.** The durable log checks timezone-aware
   times; equivalent offsets cannot admit a post-tip-off forecast. Scoring uses the
   same conversion for log selection. Legacy warehouse SQL timestamp handling still
   warrants a schema-level normalisation review.
3. **Identify fitted models.** Future publication hashes fitted parameters, ordered
   feature names and both coefficient vectors with SHA-256, incorporates this into
   the model version and exposes the training cutoff and hash in game artifacts.
   This identifies the fitted model, not the entire upstream corpus or codebase.
   Existing recorded forecasts are not retroactively assigned this provenance.
4. **Separate live cohorts.** Scoring exports proper-score summaries by model version
   and lead-time band (under 24 hours, 1–7 days, over 7 days, unknown), and retains the
   model version in per-game evidence. Existing aggregate results are preserved.
5. **Coherent final-score grids.** The grid uses fitted margin/total correlation,
   assigns no mass to tied NBA final scores, and preserves the published home/away
   probability mass even when score bounds truncate the distribution. This is a
   corrected bounded approximation, not evidence of improved outcome accuracy.
6. **Reproducible history-window experiment.** `experiment_history_window.py` tests
   three/six-year and expanding fits using prior-season window selection, subsequent
   outer seasons, monthly refits, complete earlier UTC-day training cutoffs, paired
   calendar-week uncertainty, per-season results and paired moneyline context. It
   exports input fingerprints, runtime versions and per-game predictions. It never
   writes production weights or forecasts. Results are in `reports/`.

## Highest-value next modeling work

**Align evaluation with the forecast horizon and serving path.** The game publisher
fits the full margin/total vector, but season simulation is a distinct Elo-based
system with fixed strength shocks. A daily historical game backtest cannot certify
long-range season forecasts. The publisher now advances scheduled dates and season counters on a private copy
of team state, while leaving unobserved form and rating updates unknown. Unit tests
cover back-to-backs, load, season reset, unsorted input and non-mutation. Replay
historical publication dates to measure 24-hour, seven-day and preseason horizons
separately; the correctness repair alone does not demonstrate better probabilities.

**Within-day timing still needs evidence.** The season-opener discrepancy is fixed:
Elo regression now occurs before emitting the opening feature row, and training
uses the same vector builder as serving. The paired historical comparison below
measures its effect. Start-time order alone is still not proof an earlier game's
final result was available. Use completion timestamps or conservative day-blocked
updates for shared-state features. The experiments exclude same-day targets from
fitting, but do not certify all feature availability.

**Player and roster information.** Injury history is being accumulated prospectively.
Build timestamped expected minutes and roster continuity, with uncertain availability
at a 24-hour horizon and a separate confirmed-lineup cohort. Missing injury information
is unknown, not healthy. Require coverage, acquisition timestamps and nested temporal
validation before using it as a feature. Rolling scoring averages in this repository
are not possession-adjusted NBA net rating; avoid treating those names as equivalent.

**Distribution and calibration.** Test recent residual dispersion, heteroskedastic
margin distributions and disjoint-window calibration. Evaluate log loss, Brier,
interval coverage and tails together. Preserve the coherent binary winner forecast
and benchmark an ensemble against its best constituent. More simulations reduce
Monte Carlo error, not model error. Aggregate ECE is not a per-game error bar;
the fixed value-edge floor remains a heuristic until prospective, horizon-matched
calibration and closing-line-value results support it.

**Stricter empirical comparisons.** The existing ablation script includes geography
blocks that are no longer in FEATURE_NAMES, so its default run previously requested unknown
columns. The default now filters to active blocks. Its fixed ±0.0004 noise rule is not a measured confidence interval. Replace
it with actual paired blocks, explicit archived feature configurations and untouched
future validation. Existing market bootstraps resample individual games; calendar
blocks are preferable for sensitivity to shared team/era shocks. Global base rates
estimated from evaluated outcomes are descriptive references, not prospective baselines.

**Durable horizon records and publication manifests.** The committed forecast log
preserves only the first call per game; later snapshots live in the rebuildable
warehouse. Persist immutable version/horizon snapshots independently, align taken
prices to the selected snapshot, validate monotonic coverage, and publish all views
under one manifest with a final atomic pointer. A fitted hash alone does not capture
code version, input acquisition times, or provider revisions. The current workflow
can rebuild on any warehouse download failure, so later snapshots remain vulnerable.

## Product follow-ups with measurable outcomes

Following stays on the device and now uses public franchise abbreviations instead
of warehouse IDs. A full team directory works even with an empty upcoming slate.
Filters are bookmarkable and respond to browser Back/Forward. Extend this with
optional signed-in sync. Add timestamped personal picks
locked at tip-off and score them on the same cohort as the model. Link actual game
results to changes in published playoff/title odds. A conditional season simulator
needs a backend result artifact and measured uncertainty before the browser can
claim what a win does to championship chances.

Measure team-follow activation, successful game-detail navigation, return visits,
refresh errors, and mobile loading/interaction performance. These changes have not
yet demonstrated retention gains. Keep the current warm court palette, ambient
controls, textual probabilities and visible evidence throughout.

## References

- [Scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html):
  Brier/log loss assess more than calibration; pair them with reliability plots.
- [Temporal validation](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split):
  training precedes test observations; random splitting does not model deployment.
- [NBA statistics glossary](https://www.nba.com/stats/help/glossary):
  net rating and pace have specific possession-based definitions.

## Completed history-window experiment

This experiment predates the season-boundary repair; its archived predictions
remain evidence for that original feature pipeline, not a remeasurement of the
corrected version. Local corpus: 29,653 input games; 11,543 paired outer games in seasons 2018–2026.
The input SHA-256 and exact selection folds are recorded in
[`history_window_experiment.json`](../reports/history_window_experiment.json).
Per-game inputs/predictions are preserved in the adjacent `.jsonl.gz` file (losslessly compressed, with the uncompressed SHA-256 recorded in the report).

| Metric | Expanding incumbent | Selected history window |
| --- | ---: | ---: |
| Binary Brier | 0.216304 | 0.216428 |
| Log loss | 0.621723 | 0.621981 |
| Accuracy | 65.087% | 65.096% |
| ECE | 0.010731 | 0.013009 |

Challenger minus incumbent Brier: **+0.000123**, paired calendar-week 95% interval
**[-0.000110, +0.000350]**, 307 clusters, 2,000 draws. The gate requires the upper
interval below -0.0005 and no season regression above +0.002. **Hold incumbent.**
The tiny increase in thresholded accuracy does not justify worse probability scores.
These results use a different time scope and refit cadence from the published
benchmark and do not replace it. The corpus was already explored in earlier work;
this is nested temporal research, not an untouched final test or a live result.

## Verification

- Frontend: all **179 tests in 21 suites** pass in one full run.
- Backend: all **295 tests** pass in one full run, including the new season-opener
  parity, schedule-state isolation and overlapping-fixture rejection tests. A
  subsequent 19-test safety run passes with two additional context-flag cases
  (297 unique backend tests covered in total).
- Production build passed, including type checks and all 504 static pages.
  Final lint has no warnings or errors; `git diff --check` is clean. A production-mode
  browser smoke check passed for Home, Lab, the 1,200-record API and clipboard
  sharing, with no page errors or mobile overflow. The stricter history reader
  also accepts all 1,200 existing durable history records.
- `scripts/courtside_audit.mjs`: Chromium against the actual local API + committed forecast data, at
  320, 390, 768 and 1440px. No browser page errors; no WCAG A/AA violations in the
  Lab's main content; no page overflow on Lab or Home. The 390px flow covers team
  following across reload, filters, shared-game selection, clipboard sharing,
  hypothetical records, all 30 franchises in the directory, adjustable uncertainty
  ranges, browser Back navigation, successful refresh, and a separately injected 503 response
  that preserves the previous forecast. Reduced motion is enabled in the audit.
- Visual review caught and corrected a collapsed mobile team selector, blank tiles
  while official logos were loading, a missing inline-link underline, and a narrow
  home-page rating-row overflow. Screenshots and the browser result JSON are in
  `/tmp/hardwood-courtside-v2/`. The final audit ran against the production build.

The local machine was running multiple other projects' builds, causing long compile
and test times. These runs are correctness checks, not production latency benchmarks.
The requested main-branch commit includes application changes and reproducible
research reports. Served JSON is not regenerated from the older local warehouse;
the scheduled publisher applies the corrected pipeline to its refreshed warehouse.
The new feature-pipeline identifier participates in model versioning, so future
forecasts are distinguishable from previously recorded predictions.


## Continued product improvements

The Lab includes a complete franchise-following panel, independent of the upcoming
schedule, with persistent public team abbreviations. URL filters and browser history
restore a fan’s selected view. An adjustable 50/80/95% prediction-range display makes
margin and total dispersion visible alongside win probability. Ranges are rounded
normal quantiles of the published mean and residual standard deviation, clearly
labelled as model assumptions; they do not alter any prediction or imply that
long-horizon empirical coverage has been demonstrated.


## Season-boundary comparison

[`feature_boundary_comparison.json`](../reports/feature_boundary_comparison.json)
compares immutable baseline `006d8bc` with the corrected builder on the same
29,653-game input. **22 opening-game feature rows change.** On 11,543 paired
2018–2026 games with monthly fits trained on earlier UTC days:

| Metric | Baseline | Corrected boundary |
| --- | ---: | ---: |
| Brier | 0.216304 | 0.216323 |
| Log loss | 0.621723 | 0.621773 |
| Accuracy | 65.087% | 65.104% |

Corrected minus baseline Brier is **+0.0000189**, paired week-block 95% interval
**[+0.00000335, +0.00003569]**. This is a small historical regression, not an
accuracy improvement. The change is retained to make the first training row of a
season agree with served preseason ratings and the Elo update; selecting inconsistent
features for a marginally better backtest would preserve the defect. It does not
validate long-range schedule adjustments. Immutable baseline/source/input hashes
and compressed per-game paired predictions make the comparison reproducible.


A serving smoke test trained on all 29,653 local games and evaluated the committed
1,200-game upcoming schedule after mapping public abbreviations to local IDs. It
found 121 home and 134 away back-to-backs, zero to four prior games in seven days,
and expected totals from 206.07 to 250.14. All probabilities were valid and observed
state was unchanged. No production artifact was written. The skew guard now exempts
constant playoff/neutral flags only when their values agree with every fixture,
avoiding false alarms on homogeneous slates while retaining incorrect-flag detection.
