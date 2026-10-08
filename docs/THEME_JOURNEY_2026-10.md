# Hardwood theme across the full journey

The October 8 audit started from main
`5bb550c43446ce24f594b8e6a85294a7294241b3`, including the player profile,
comparison and dated shooting-context features. The original palette was
already coherent: walnut page/card surfaces, cream logo plates, orange chrome,
sans-serif headings and monospace controls/numbers. Hardwood intentionally has
one dark theme. System light/dark preferences do not switch that identity.

## Verified fixes

- Native selects inherited the browser's default scheme while only the slate
  date picker declared dark mode. The root now declares `color-scheme: dark`;
  the date picker inherits it with every other native control.
- A saved Court `off`/`vivid` preference applied to the court before paint, but
  the server-rendered dial highlighted `soft` until hydration. The pre-paint
  root attribute now controls both highlights. The group defers its pressed
  announcement until the client knows the preference, so its server and initial
  client markup agree. The three choices and existing storage key are unchanged.
  If a recreated root loses the attribute, subscribing dials restore the saved
  preference and notify the canvas without changing storage.
- Inline links in prose, footer copy and a team section heading depended on
  color alone. Persistent underlines now provide a visible non-color cue.
- Small red negative/miss labels on archive and methodology pages used ink
  with about 3.73:1 contrast on walnut cards. Those labels now use the existing
  brighter `--accent-loss-soft` token. Large outcome numbers and validated
  chart/fill colors retain their existing tokens.
- Four comparison tables on the accuracy page could scroll on narrow phones
  without keyboard focus. Their containers now have descriptive region names
  and keyboard focus, using the existing focus ring.
- Four homepage text links showed missing-font boxes in place of decorative
  arrows in cloud Chromium. Small SVG marks retain the same cue without a
  font dependency and are hidden from the accessible link names.

No model, forecast, archive, ingestion, workflow, dependency or access setting
is changed. This improves readability and preference consistency; it makes no
claim about prediction accuracy or performance.

## Connected browser verification

The saved cloud environment ran actual Chromium against production builds at
320, 390 and 1440 px. The 1440 px journey ran under both system color preferences;
320 used light and 390 used dark. Each journey followed links and menus through:

Today → dated/filtered slate and empty recovery → upcoming game → empty shooting
sample and explicit prior-season reference → reload → team → completed game and
player comparison → game profile → contextual Back and browser Forward/Back →
head to head → Forecast Lab → ratings → methodology → accuracy → archive list →
season → playoff series → archive games → current season → bracket → All-Star →
upsets → season preview → playoff picture → bare-profile empty state → unknown
game/404 → schedule recovery → controlled loading → error → keyboard retry.

Every recorded state checks the root dark scheme, walnut backgrounds, existing
tokens, native control schemes, heading font/case, horizontal overflow and
full-document axe WCAG 2 A/AA. Keyboard activation checks the Court dial and
retry; an evidence table accepts focus and horizontal arrow input. Shooting
scope/window selections survive reload; comparison pairs survive the profile
round trip and browser history. Court `off` persists across the journey.
The four journeys record 124 states; the separate source-outage state brings
the full-document accessibility checks to 125, with zero final violations or
horizontal overflow and zero unexpected errors in the accepted journeys.

Separate cold-load checks delay client scripts and prepopulate stored `off` and
`vivid` choices under a light system preference. They inspect the dial before
hydration, then its pressed announcement after hydration, and sample paint
frames for a stable walnut background and preference. The SSR regression test
also ensures the server never invents a pressed `soft` selection.

The unmodified product production build separately verifies the source-outage
state on a completed game. Product and isolated fixture builds generate all
504 static pages; the fixture adds only its temporary controlled route.
All 268 frontend tests, lint and TypeScript pass.

[Machine-readable results](theme-journey-qa-2026-10-08.json) record each state,
system preference, accessibility result and cold-paint observation.

![Hardwood desktop journey](screenshots/theme-home-desktop.png)

[Mobile shooting context](screenshots/theme-shooting-mobile.png) ·
[Mobile comparison](screenshots/theme-comparison-mobile.png) ·
[Game profile](screenshots/theme-profile-mobile.png) ·
[Evidence](screenshots/theme-evidence-mobile.png) ·
[Controlled loading](screenshots/theme-loading-mobile.png) ·
[Controlled error](screenshots/theme-error-mobile.png) ·
[Saved Court off before](screenshots/theme-cold-off-before.png) ·
[Saved Court off after](screenshots/theme-cold-off-after.png).

## Evidence and limits

The connected player/comparison journey uses the existing ESPN-only preload
with explicitly synthetic QA Guard/Reserve/Forward lines. Team results,
forecasts and shooting rates use the committed real artifacts. CDN logos are
deliberately unavailable so the original abbreviation fallbacks can settle
before measurements. The outage build controls the ESPN reader to HTTP 503.
These checks establish interaction and theme behavior, not live feed coverage.

One exploratory 390 px hard profile load triggered a React #418 hydration
recovery and lost the root Court attribute. Sixteen isolated cold loads and
subsequent complete journeys did not reproduce it. The missing-attribute
recovery now has a two-dial regression test and a controlled browser check;
the origin of the intermittent React warning remains an independent review
item. No dependency upgrade or blanket warning suppression is introduced.
The [exploratory observation](theme-hydration-observation-2026-10-08.json)
retains the failed state separately from the acceptance results.

Loading and error screenshots use an isolated `/tmp` copy. Its temporary route
delegates to the product game page after a short delay, conditionally fails via
a local flag, and uses the actual game loading/shared error boundaries. The
extra route and team-page test link are absent from the product source/build.

Screenshots are visually inspected; the public deployment/proxy restriction
was not retried or bypassed. Live ESPN success and public browser rendering
remain unverified. No production job or workflow was manually dispatched, and
the draft awaits independent review before merge.

## Reproduce

```sh
QA_COPY=/tmp/nba-theme-new-fixture node scripts/qa/prepare_theme_journey.mjs
```

The helper refuses an existing destination. Build/start that copy with
`NODE_OPTIONS=--require=/workspace/nba_predictor/scripts/qa/game_comparison_fixture.cjs`
and `QA_FIXTURE_MODE_FILE=/tmp/nba-theme-new-fixture/qa-available-mode` on port 3191.
Build/start the unmodified product with the existing `player_profile_fixture.cjs`
preload and a mode file containing `unavailable` on port 3192. Use a fresh build
and free ports for each server; then run:

```sh
QA_BASE=http://127.0.0.1:3191 QA_PRODUCT_BASE=http://127.0.0.1:3192 node scripts/theme_journey_audit.mjs
```

The audit writes its report and screenshots under `/tmp/nba-theme-journey-qa`.
