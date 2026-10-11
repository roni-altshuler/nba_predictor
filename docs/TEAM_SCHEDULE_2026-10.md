# Team schedule exploration — 11 October 2026

Opening a team from an upcoming matchup used to put its next eight games below
historical player links and rating charts. In the production baseline at
`9cee669a169806a9535b74b4e5be83402a45069a`, Boston's schedule began 1,958 px
down a 320 px page. There were no schedule filters or publication timestamps.

The new panel follows the season outlook, before historical content. Native
section links keep season projections, players and ratings reachable. Schedule
prominence and team navigation take inspiration from [NBA team
pages](https://www.nba.com/team/1610612738/celtics); the layout and Hardwood
branding are original.

## Behavior and boundaries

- Explore all games in this team's published snapshot, six at a time. Filter
  by Eastern-time month and home, away or neutral court. Month boundaries use
  Eastern dates; sorting uses actual UTC instants.
- Open a row with the keyboard or pointer to see its venue, explicitly
  projected score and total, then visit the matchup or that day's team-filtered
  slate. Native details expose their expanded state to assistive technology.
- Month, court and displayed count live in the URL. Reload, browser history and
  returning from a matchup restore them. Invalid filters/counts recover to
  usable defaults; unrelated query parameters survive edits. Changing a filter
  resets paging, and empty selections offer reset.
- On a cold shared URL, controls remain disabled and the panel announces
  “Restoring schedule filters…” until hydration restores the selection.
  Missing publications stay unavailable, with no invented probability or record.
- A scoped cream surface, dark ink and visible control borders sit within the
  existing walnut shell. Native schedule controls use the light surface scheme;
  the surrounding app retains its dark scheme. Links and controls have 44 px
  targets. No chart hues or global theme tokens change.

The panel labels the 2026–27 regular-season forecasts, scheduled status,
publication time and results-used-through time. The audited snapshot contains
80 Boston games, published `2026-10-10T16:08:02+00:00`, trained through
`2026-06-14T00:30:00+00:00`. Coverage is the published snapshot, not a complete
league schedule. Preseason exhibitions are outside this forecast; zero settled
regular-season forecasts before opening night are expected. Injuries and roster
changes remain outside the model. The UI formats existing probabilities and
score estimates; it changes no artifact, model, source timestamp or accuracy claim.

The server selects only this team's display fields before serialization. Boston's
80 rows plus panel metadata serialize to **25,962 UTF-8 JSON bytes**, compared
with **740,827 bytes** for the entire 1,200-game artifact. These measurements
exclude React framing and compression. The existing server-rendered
`MatchupHeader` timestamp boundary remains intact. Type-only artifact imports
keep published JSON out of the new client module graph.

## Verified evidence

The saved cloud environment ran a Next.js **15.5.27 production build**, then real
Chromium journeys over unchanged committed forecasts. This is local production
QA; it is not a claim that the restricted Vercel preview was browser-accessible.

| Width | Old schedule top | New schedule top | Checked states |
|---|---:|---:|---:|
| 320 px | 1,958 px | 534 px | 18 |
| 390 px | 1,842 px | 486 px | 18 |
| 768 px | Not measured | 372 px | 18 |
| 1,440 px | 1,439 px | 344 px | 18 |

All **73 accessibility scans** passed with no horizontal overflow or unexpected
browser errors: 72 journey states plus a delayed cold shared URL. The journeys
covered section links, keyboard disclosure and paging, reload, same-page and
cross-page back/forward, repeated matchup returns, day-slate date/team links,
empty filters, reset and malformed shared URLs. At each width an uncached matchup
response was held; choosing the already visited slate cancelled that navigation.
Releasing the response did not replace the slate, and returning restored the
shared team filters.

ESPN logo requests were deliberately unavailable, exercising abbreviation
fallbacks. The existing preload returned provider HTTP 503 in the isolated
product copy; no synthetic scores or player lines entered these product journeys.
Diagnostics retain controlled failures and reject every unexpected console/page
error, including hydration errors. Raw documents, events, traces and build/test
logs remain in `/tmp/nba-team-exploration-2026-10-11` in the saved environment.
An earlier runner assertion used the wrong casing for a CSS-uppercase label;
its failure log is retained. Correcting that assertion required no product change.

The existing broader theme runner also passed a **31-state 390 px journey**,
including archive/player links and controlled loading, error and keyboard retry
recovery. Its existing synthetic player responses and temporary error route
were confined to a separate `/tmp` fixture copy. The actual product separately
passed unavailable-provider handling, both cold Court preferences and preference
recovery; those checks reported no unexpected errors.

Local gates passed: **278 frontend tests in 36 suites**, **409 backend tests**,
lint with no warnings, TypeScript, and all **504 static pages**. New regression
tests cover artifact orientation/immutability, Eastern month boundaries, invalid
URLs, missing publications, paging and restored state. The compact
[QA results](qa/team-schedule-2026-10/results.json) include source hashes,
measurements and diagnostic counts. Exact PR head and CI/deployment check links
are recorded in the draft PR.

## Screenshots and reproduction

[Before mobile](qa/team-schedule-2026-10/before-mobile.png) ·
[After mobile](qa/team-schedule-2026-10/after-mobile.png) ·
[Projected matchup at 320 px](qa/team-schedule-2026-10/projected-matchup-mobile.png) ·
[After desktop](qa/team-schedule-2026-10/after-desktop.png).
Screenshots show controlled missing-logo fallbacks, not unavailable live logos
presented as fetched assets.

Build/start an isolated copy with the existing ESPN-only
`scripts/qa/player_profile_fixture.cjs` preload and a mode file containing
`unavailable`; never deploy that preload. Then, from the source checkout:

```sh
QA_BASE=http://127.0.0.1:3211 \
QA_OUT=/tmp/nba-team-schedule-new-evidence \
node scripts/team_schedule_audit.mjs
```

The runner needs installed Playwright/axe and Chromium (`QA_BROWSER` can select
its executable). No credential, paid provider, production dispatch or model
training is required. Safari/Firefox and a live ESPN validation remain outside
this bounded change.
