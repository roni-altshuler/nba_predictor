# Games-first homepage — 12 October 2026

The prior homepage showed a large selected-game forecast before a second
scoreboard. At 390 px, the selected forecast was 584 px tall and the scoreboard
heading began 1,995 px down the page. At 320 px it began 2,291 px down. This made
basic game browsing take more scrolling than reading the selected prediction.

## Bounded change

The homepage now leads with the next published Eastern-time slate, using the
existing `LiveSlate` and confirmed-score hook. Compact rows link directly to
both teams and the matchup/player surface. Every game in that published day is
included; the old four-card cap is removed. Other published dates link into the
existing shareable daily slate. The complete team explorer stays visible.

Each native **Model outlook** disclosure gives the published favourite/chance,
explicitly projected score/total, input limitations and a link to the existing
forecast evidence. An even matchup is labelled without an arbitrary pick. This is the
existing statistical forecaster; no generative AI, new model, probability
recalculation or accuracy claim is introduced. The larger season ladders, stats
and evidence remain in a native disclosure. Full following, hypothetical records
and model-range controls remain in Forecast Lab.

The header names the 2026–27 regular season and the preseason publication as
determined from the artifact's publication and season-start timestamps. It says
exhibition forecasts are unavailable and, only for a matching season's `n: 0`
live record, says there are no settled regular-season forecasts yet. That is
expected before opening night. Missing/empty publications offer useful schedule
and archive links without fabricated games or probabilities.

Confirmed live/final scores use the existing parser, event-ID join, polling
cadence and failure handling. Real zero scores remain zero. Partial scores are
unavailable; an unconfirmed post state cannot become Final, and a cleared overlay
removes stale scores. Before tip-off the row shows its time and `vs`, without
pretending its projected score is a result. Forecast timing and coverage remain
accessible on demand. Models, aliases, provider endpoints, bot artifacts,
dependencies, security and the static sport palette are unchanged.

## Verified production behavior

The saved cloud production build used the unchanged committed artifact at base
`7d616eb456ed9222e982be111498b6f2f486a025`. Its first slate has three regular-season
forecasts on 20 October, published `2026-10-11T16:32:23+00:00`, trained through
`2026-06-14T00:30:00+00:00`. It is published coverage, not the complete league or
preseason schedule.

| Width | Prior scoreboard top | New games-section top |
|---|---:|---:|
| 320 px | 2,291 px | 251 px |
| 390 px | 1,995 px | 219 px |
| 768 px | Not measured | 144 px |
| 1,024 px | Not measured | 144 px |
| 1,440 px | 1,195 px | 124 px |

All **60 normal-motion states** passed at 320/390/768/1024/1440 px, with light
and dark OS preferences represented. They covered native keyboard disclosures,
nonoverlapping action targets, repeated matchup/back-forward, daily date/team
filters and empty recovery, bookmarked team month/court/paging and reload,
and interrupted navigation. An uncached matchup response was held, a team was
selected, and releasing the late response did not replace that team page.
Accessibility scans found no WCAG 2A/2AA violations or horizontal overflow,
and diagnostics found no unexpected console/page errors. Idle observations
found no canvas draws, ambient nodes or continued frame callbacks.

The broader production theme fixture passed its **31-state mobile journey**,
including archive/player navigation and controlled loading/error/keyboard retry.
A temporary dynamic homepage with its fixture forecast file withheld showed the
actual unavailable state, zero game rows and no accessibility/browser errors;
the file was restored in `finally`. Five explicitly synthetic scoreboard
envelopes exercised live zero, final, unconfirmed post, partial and unavailable
states without changing the published probability. They are UI contract checks,
not claims of actual preseason scores or model settlement.

Local gates passed: **281 frontend tests in 37 suites**, lint without warnings,
TypeScript and a Next.js 15.5.27 build generating all **504 static pages**.
New tests cover source links/disclosure, real-zero vs missing/unconfirmed scores,
cleared overlays, full supplied-game coverage, missing publications and honest
preseason/live-record context. Automatic exact-head CI/deployment links are
recorded in the draft PR. Existing tests were retained.

## Evidence, retained failures and limits

The first navigation harness expected Back to jump out of all team filter
history entries. Existing Back correctly restores the previous query state;
the runner now checks that behavior and uses the brand link to return home.
A real tablet action-target overlap was caught, fixed by using wider rows until
the three-column desktop breakpoint, and rechecked at 768 and 1024 px. Both
failed runs remain in the saved evidence. No retry hides a product failure.

All product journeys use committed forecasts and controlled unavailable provider
responses/logos. Synthetic player lines and the temporary error/home routes live
only in a separate `/tmp` fixture. No fixture is deployed and no provider job
is dispatched. The existing More-menu Escape focus-to-body behavior remains
outside this slice. Hosted pixels remain unverified under existing proxy/preview
restrictions. Chromium was tested; Safari/Firefox, live ESPN and a model temporal
evaluation were not performed or claimed.

Raw HTML, events, failures, source hashes, measurements and logs remain in
`/tmp/nba-home-slate-2026-10-12`. Compact results and before/after pixels are
committed below. Existing local branches/worktrees and bot data are preserved.

[QA receipt](qa/home-slate-2026-10/results.json) ·
[Before mobile](qa/home-slate-2026-10/before-mobile.png) ·
[After mobile](qa/home-slate-2026-10/after-mobile.png) ·
[Model outlook](qa/home-slate-2026-10/model-outlook-mobile.png) ·
[Before desktop](qa/home-slate-2026-10/before-desktop.png) ·
[After desktop](qa/home-slate-2026-10/after-desktop.png).

From a matching dependency checkout, start an isolated production build with the
existing ESPN-only unavailable preload, then run:

```sh
QA_BASE=http://127.0.0.1:3231 \
QA_OUT=/tmp/nba-home-slate-new-evidence \
node scripts/home_slate_audit.mjs
```

The broader fixture uses `scripts/qa/prepare_theme_journey.mjs` and the updated
`scripts/theme_journey_audit.mjs`. Never deploy a QA preload or temporary route.
