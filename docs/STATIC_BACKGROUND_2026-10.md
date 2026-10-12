# Static backgrounds — 12 October 2026

The owner requested complete removal of distracting animated backgrounds.
This change starts from main `0c46874b9eff4b41459aaa9bc45f438954a13a9f` and
removes the global decoration across every Hardwood page.

## Exact scope

- Delete `CourtField`: the canvas, game simulation, animation-frame loop,
  resize/visibility/preference listeners and reduced-motion still.
- Delete `AmbientBackground`, its two drifting ember layers, plank gradients,
  animation keyframes and unused color tokens.
- Delete the sidebar/mobile Court dial, its subscription, startup storage script
  and ambient-specific root hydration suppression. Existing saved
  `hardwood-ambient` values are ignored without being cleared or rewritten.
- Paint the shell with the body's solid walnut color. Cream logo plates and
  the cream team schedule, off-white text, orange navigation and chart colors
  retain the current sports identity. This remains the existing dark-only app
  under both light and dark OS preferences; no theme switch is introduced.
- Retire the five tests for the deleted dial and update the current connected
  theme runner to check static cold paint and ignored legacy choices. Update
  README and current design instructions so they cannot reintroduce decoration.

Native focus/hover feedback, menu/tab transitions, route entry, chart tooltips,
probability/number updates, bracket links, live-status badges and genuine loading
skeletons remain. The useful SVG charts and brackets are data displays, not
background scenes. No hidden decorative runtime remains. Forecasts, models,
provider behavior, dependencies, security settings and bot data do not change.
The existing streamed-route hydration regression boundary is retained.

## Source and browser verification

The current-main production baseline visibly contained court lines and moving
players behind the home and team pages. At 320, 390 and 1440 px, normal-motion
observations found one canvas, two infinite CSS glow animations, and 34–36 canvas
redraws in each 1.2-second measurement window. Default Soft and saved Vivid were
both exercised. Before pixels and raw measurements are retained.

The new `scripts/static_background_audit.mjs` checks actual production pages at
320, 390, 768 and 1440 px under **both OS color preferences**, with normal motion
enabled. Its probe wraps frame requests/cancellations and canvas clearing; it
creates no sampling loop itself. After intentional UI feedback settles, each
state observes a fresh 1.2-second idle window and requires zero new/pending frame
callbacks, zero canvas draws/nodes, zero ambient nodes/attributes, no running
animations or SVG animation elements, and a solid background with no image.
Accessibility and overflow checks run separately.

All **83 normal-motion states** passed these runtime, accessibility and overflow
checks with zero unexpected browser errors: 9 each for both preferences at
390/768 px and light at 320/1440 px, 15 at 320 px dark and 14 at 1440 px dark.
The extra dark cases exercise the interaction paths. Production JS/CSS chunks
also contain none of the deleted decoration or preference identifiers.

Representative pages cover home, team, daily slate, upcoming matchup, completed
game, unavailable player, projected bracket, head-to-head and accuracy. Interaction
checks cover team filtering and repeated back/forward, chart touch tooltip,
slate date selection, predictor swap, archive bracket links, and mobile keyboard
menu opening/tabbing/Escape. Saved Vivid is exercised and remains unchanged in
storage. The updated broader theme runner also verifies the existing 31-state
mobile archive/player journey, controlled loading/error/keyboard retry, delayed
cold paint with legacy Off/Vivid, and unavailable-provider handling.

Product QA uses unchanged committed artifacts and the existing ESPN-only preload
returning HTTP 503. Logos are deliberately unavailable, exercising abbreviation
fallbacks. Only the separate broad theme fixture uses its existing synthetic
player lines and temporary error route. No fixture or preload is deployed.
Raw documents, diagnostics, failures, timing measurements and build/test logs
remain in `/tmp/nba-static-background-2026-10-12` in the saved cloud environment.

Local checks pass: **273 frontend tests in 35 suites**, lint without warnings,
TypeScript and a Next.js 15.5.27 production build generating all **504 static
pages**. Five obsolete dial tests were removed; no unrelated tests were dropped.
The exact draft head, automatic CI/deployment checks, final runtime counts and
source hashes are recorded in the PR and compact QA receipt.

## Limits and known baseline findings

- The first new runner assumed every page had a visible `h1`; the existing
  archive game uses “Scoring by period” as its checked heading. Correcting the
  runner's destination selector required no product change. Its failure remains
  in the raw evidence.
- The initial mobile check expected Escape to restore focus to More. A separate
  baseline/product comparison found focus returns to `BODY` on both builds.
  Opening, tabbing and closing remain usable. This existing focus-restoration
  issue is recorded separately and is not fixed in this removal PR; its failed
  assertion and comparison evidence are retained.
- Tests use Chromium in the saved cloud production environment. Hosted pixels
  remain unverified because existing proxy/preview restrictions prevent access.
  No bypass, new credentials or security changes are attempted. Safari/Firefox,
  live ESPN and a genuinely live game's status pulse are outside this QA.
- The idle observation is a bounded runtime check, not a CPU/battery benchmark
  or a promise that meaningful UI feedback never schedules a frame.

The dated Court/design investigations remain historical evidence. They do not
describe current controls or current decorative motion.

## Reproduction

Build/start an isolated copy with the existing
`scripts/qa/player_profile_fixture.cjs` preload and a mode file containing
`unavailable`; never deploy that preload. From a source checkout with the
matching dependencies, Playwright/axe and Chromium installed:

```sh
QA_BASE=http://127.0.0.1:3221 \
QA_OUT=/tmp/nba-static-background-new-evidence \
node scripts/static_background_audit.mjs
```

`QA_BROWSER` can select the Chromium executable. The broader fixture is prepared
with `scripts/qa/prepare_theme_journey.mjs` and checked using the updated
`scripts/theme_journey_audit.mjs`. Exact-head screenshots and compact results
are linked from the draft PR.

[Compact measurements and source hashes](qa/static-background-2026-10/results.json) ·
[Before desktop](qa/static-background-2026-10/before-desktop.png) ·
[After desktop](qa/static-background-2026-10/after-desktop.png) ·
[Before mobile](qa/static-background-2026-10/before-mobile.png) ·
[After mobile](qa/static-background-2026-10/after-mobile.png).
