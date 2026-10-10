# Next.js 15 maintenance — 2026-10-10

Base: `a434088e808cd98cb72bf48430e32d292e35fbe5`. Remote main and open PRs
were checked first: no open NBA PRs; both saved recovery worktrees were clean
and left intact. Repository guidance is `CLAUDE.md`; no `AGENTS.md` or local
`.agents`/`.codex` skills were present. Work is isolated on
`codex/next-15-maintenance-2026-10-10`.

`next` and `eslint-config-next` move from 15.5.24 to **15.5.27**, with only
their corresponding Next packages changed in the lockfile. The npm registry
lists 15.5.27 as the highest published stable 15.x version on this date. Its
Node and React peer ranges accept the existing toolchain and React 18.3.1.
No application code, data, models, workflows or access settings change.

## Official scope

The [15.5.27 release](https://github.com/vercel/next.js/releases/tag/v15.5.27)
and GitHub's reviewed advisory database identify the fixes:

- [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p):
  Next 15 versions below 15.5.27; root catch-all page with SSG/ISR required.
  The source and built route inventory contain **no catch-all routes**.
- [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676):
  Next 15 versions below 15.5.27; self-hosted Pages Router SSG/ISR. The
  advisory excludes Vercel deployments; Hardwood uses App Router on Vercel.
- The release also lists
  [GHSA-f87g-xv8r-7p7x](https://github.com/vercel/next.js/security/advisories/GHSA-f87g-xv8r-7p7x)
  for metadata image routes. Its published affected range starts at Next 16.

These are version-level maintenance findings, not evidence of exploitation
or demonstrated exposure in the deployed product. The original repository
advisory pages still show placeholder patch numbers; the reviewed database,
release and npm audit feed give the concrete 15.5.27 boundary.

The [October 14 announcement](https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026)
promises future advisories and upgrade instructions but publishes no affected
versions. This patch does not claim to address that future release.

## Audit and regression evidence

Both requested GHSA entries disappear from `next.via` after the upgrade.
Aggregate npm audit counts remain **16** (11 high, 5 moderate), and production
counts remain **3** (2 high, 1 moderate): Next still inherits findings from its
bundled PostCSS 8.4.31; `source-map-js` and existing development tooling findings
also remain. No broad audit fix, major upgrade or override was applied.
Both audits exit 1 for these retained findings. See
[compact machine-readable evidence](next-maintenance-qa-2026-10-10.json).

Local gates: 409 backend tests; 270 frontend tests in 34 suites; lint without
warnings; TypeScript; clean npm install; 504-page production build. The existing
PageTransition positive and deliberately mismatched hydration tests both pass.
The bundled App Router renderer remains
`19.2.0-canary-0bdb9206-20250818`, byte-identical to 15.5.24. Generated CSS
and all 29 App Router route entries are identical to the baseline build.

## Browser evidence and reproduction

Cold Home, dated Games and Accuracy views at 320/light, 390/dark and
1440/light produced **nine byte-identical before/after PNGs**, zero WCAG 2 A/AA
axe violations, no horizontal overflow and no unexpected diagnostics. Both
versions render the same dark-only product. The browser is Chromium
151.0.7922.173; local gates use Node 24.19.0 and npm 11.9.0 (CI uses Node 20).

Representative unchanged views:
[Home, 320px](screenshots/next-maintenance-2026-10-10/home-320.png),
[Games, 390px](screenshots/next-maintenance-2026-10-10/games-390.png),
[Accuracy, 1440px](screenshots/next-maintenance-2026-10-10/accuracy-1440.png).

The connected production fixture completed **31 checked states at each of
320/light, 390/dark and 1440/light**, plus a product source-outage state:
**94 axe scans**, no horizontal overflow and no unexpected browser errors or
warnings. Every transition asserts its destination URL and content. Coverage
includes slate/date/franchise filters and empty views, game/shooting context
reload, player comparison and profile return, browser back/forward, archive
series/results, keyboard table scrolling, not-found recovery, loading,
controlled error/retry, and source-unavailable coverage. Court preferences
remain stable through navigation; two delayed-script cold paints and a
controlled missing-root-attribute recovery also pass. The 18 unchanged-view
comparison scans bring this patch's total to **112 axe scans**.
All QA runs use local production builds and system Chromium. Real committed
artifacts are retained; synthetic player responses and the controlled loading,
error and retry route exist only in isolated `/tmp` copies. Browser ESPN logos
are deliberately unavailable, and the scoreboard is controlled HTTP 503;
diagnostics retain these expected failures. This is not live deployment QA.

Raw audit JSON, gate logs and browser diagnostics remain in the saved cloud
environment at `/tmp/nba-next-maintenance-evidence`. An initial baseline build
and product-server invocation used `/tmp` as the working directory and failed
before starting the app; corrected invocations and their logs are retained.
The default npm cache was unwritable, so commands use a task-owned `/tmp` cache.

The unchanged-view comparison helper remains at
`/tmp/nba-next-baseline-2026-10-10/compare-ui.mjs`, with its checksum in the
compact evidence. Run it from that saved baseline copy with `QA_BASE` and
`QA_OUT` set for each running build. The normal build was copied into an
isolated product QA directory; the connected fixture uses the existing
`scripts/qa/prepare_theme_journey.mjs` and ESPN comparison preload. Rerun its
audit against these saved local servers with:

```bash
QA_BASE=http://127.0.0.1:3201 \
QA_PRODUCT_BASE=http://127.0.0.1:3202 \
QA_PRODUCT_SOURCE_COMMIT=a434088e808cd98cb72bf48430e32d292e35fbe5 \
QA_JOURNEYS='[[320,"light"],[390,"dark"],[1440,"light"]]' \
QA_OUT=/tmp/nba-next-maintenance-repeat \
node scripts/theme_journey_audit.mjs
```

The `QA_PRODUCT_SOURCE_COMMIT` records the source base; the patch under test is
identified by the evidence's package lock checksum. The legacy runner's fixed
`baseCommit` field is historical and is not the base of this maintenance patch.

```bash
npm --cache /tmp/nba-next-npm-cache ci --no-audit --no-fund
npm --cache /tmp/nba-next-npm-cache audit --json
npm --cache /tmp/nba-next-npm-cache audit --omit=dev --json
python -m pytest backend/tests/ -q
npm test -- --ci --runInBand
npm run lint
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
```

Use the Python environment containing `requirements.txt` dependencies. No
warehouse rebuild, forecast publication, training or workflow dispatch is needed.
