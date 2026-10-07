# Single-game line comparison — October 2026

The completed game page already has a team-total comparison, full player tables,
and provider-qualified single-game profiles. This addition reuses those inputs
for a focused reading aid: pick two supplied athlete IDs from this game and see
the same reported lines side by side. It adds no endpoint, collection job, model,
chart library or image source. Styling uses Hardwood's existing dark walnut,
cream ink, hairlines and native controls.

## Data boundary

- The existing ESPN summary reader is called by the game page, scoped to a known
  archived event. Selecting or swapping players makes no additional request.
- A compact client projection carries only named lines, provider/team identity,
  the response's labels and stats, DNP state, and the existing profile URL. Team
  totals, logos, leaders and unrelated games are not passed to the comparison.
- `compareLeft` and `compareRight` name known distinct provider-qualified keys.
  Unknown, duplicated or mismatched keys fall back to supplied distinct lines.
  Native history entries and the local Next query observer restore the controls
  and columns after back/forward and cached same-path navigation.
- Team names come from the selected game's response. Modern normalized franchise
  names are not used here. A missing response name stays explicitly unavailable.
- Values are as reported, including `0`, `0-2` and plus/minus strings. Each side
  uses its own supplied column labels; missing cells remain dashes. DNP state
  removes even stray source stats and preserves the supplied reason.
- The date uses America/New_York. The sample is one game per player, source update
  time is unavailable, and no possession or pace adjustment is inferred. One
  observed line cannot establish player quality or future performance.
- All-Star tables keep their existing behavior without comparison/profile links.
  Fewer than two usable identities explains the unavailable comparison while the
  original table remains. A missing summary keeps the game result and existing
  source-unavailable panel.

## Verification

The durable browser runner is `scripts/game_comparison_audit.mjs`. Its available
data comes from `scripts/qa/game_comparison_fixture.cjs`, layered over the existing
profile fixture in an isolated `/tmp` copy. QA names and athlete IDs are synthetic;
game IDs, dates and published results are from the committed archive. No synthetic
player lines are added to published artifacts or the product build cache.

The unmodified production build is tested separately with the existing source
reader returning 503. Temporary delay/error controls exist only in the isolated
copy, and expose the existing profile route loader and retry boundary through
client navigation in Chromium. Comparison selections themselves are synchronous.
The runner distinguishes these fixture states from real source coverage.

`scripts/qa/prepare_game_comparison.mjs` creates a new `/tmp` copy with those
controls and refuses to overwrite an existing directory. To reproduce, build both
the product and isolated copy with the QA preload's mode file set to `unavailable`;
then start the isolated server using its `qa-available-mode` file and
`scripts/qa/game_comparison_fixture.cjs` preload. Start the unmodified product
server with the existing profile fixture preload and the unavailable mode. Pass
their localhost addresses as `QA_BASE` and `QA_UNAVAILABLE_BASE` to the browser
runner. These preloads are for local QA only, never a deployment configuration.

Local checks: 255 frontend tests, 353 backend tests, lint, TypeScript, and a
production build with 504 generated routes. The Sharp native SVG conversion
smoke check also passed. Browser results and screenshots are recorded alongside
this document in [game-comparison-qa-2026-10-07.json](game-comparison-qa-2026-10-07.json).
Chromium interaction passed at 320, 390, 768 and 1440 pixels: native keyboard
selection and swap, visible focus, repeated changes, shared-URL reload,
back/forward, game-profile Back/forward, supplied historical names, DNP/missing
cells, empty identity coverage and reduced motion. At 320, 390 and 1440, the
unmodified app's source-outage state retained the result; the isolated profile
loader rendered with motion disabled; and the inherited error boundary rendered
and recovered after keyboard retry at 320 (recovery checked at all three widths).
No horizontal overflow, portrait requests, unexpected comparison browser errors,
or WCAG A/AA axe violations were found in the audited comparison, empty, outage
and error surfaces. Screenshots were visually inspected in the cloud environment.
Browser checks are a shipping gate; successful builds alone do not meet it.

Screenshots use explicitly synthetic player fixtures:

- [Desktop comparison](screenshots/game-comparison-fixture-desktop.png)
- [Mobile comparison](screenshots/game-comparison-fixture-mobile.png)
- [Empty identity coverage](screenshots/game-comparison-empty-mobile.png)
- [Source unavailable, unmodified app](screenshots/game-comparison-source-unavailable-mobile.png)
- [Inherited profile loading](screenshots/game-comparison-loading-mobile.png)
- [Inherited error boundary](screenshots/game-comparison-error-mobile.png)

Card captures increase the viewport height to show the entire component without
the fixed mobile navigation covering its footnote; interaction checks use the
listed widths and a 1000-pixel viewport height. Public Vercel browser access was
previously blocked by the cloud proxy and was not retried. These are local cloud
Chromium checks, not a claim about live ESPN player coverage.

Browser QA also identified two small accessibility fixes on the existing game
page: its inline accuracy link now has a permanent underline, and player-table
scroll regions are focusable even when no supplied ID produces a profile link.

## Narrow dependency patch

The October 7 npm audit identified pinned Sharp 0.35.4 as affected by
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), added to the
GitHub Advisory Database October 6. The upstream advisory identifies 0.35.5 as
patched. This branch pins only Sharp to 0.35.5 and refreshes its matching optional
binaries/libvips entries. Local native inspection confirms librsvg 2.63.2; a small
SVG converted successfully. The Sharp finding disappears from the follow-up audit.

The full audit is **not clean**: 50 affected package entries remain (46 high,
4 moderate, zero critical), including transitive tooling findings. The production
audit retains three entries (Next's PostCSS chain: two high, one moderate). There
is no direct Next.js advisory in this audit; its status is inherited from PostCSS.
No claim that the whole dependency tree is secure is made. Resolving PostCSS,
source-map-js and the build-tool chain needs separate compatible patch review;
this bounded visual task does not perform broad dependency upgrades or overrides.
See `game-comparison-advisory-2026-10-07.json` for the checked counts, packages and
remaining direct advisory links. Repository Dependabot alert access is unavailable
through the connected GitHub read tool; the lockfile/npm audit supplies this check.
