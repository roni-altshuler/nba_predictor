# Security dependency updates — 2026-10-05

## Scope and selection

- Next and eslint-config-next: 15.5.23 → **15.5.24**, staying on Next 15 and React 18. The framework release covers [the AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) and [Windows server RCE](https://github.com/advisories/GHSA-p293-qw3h-jr36).
- sharp: 0.35.3 → **0.35.4**, covering [the libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c). Next now accepts this compatible minor line, so its vulnerable nested sharp 0.34 copy is removed. Runtime resolution and `npm ls --omit=dev` confirm Next uses 0.35.4 with libheif 1.23.2; no override is needed.

All locked HTTPS package downloads resolve to `registry.npmjs.org`. Exact framework/test-tool pins keep this change reproducible. Other direct dependency declarations, application code, UI, forecasts, credentials and deployment settings are unchanged. Required transitive and deduplicated packages are recorded in the lock diff.

Local validation used Node 24.19.0, npm 11.9.0 and Python 3.12.14. Browser checks used system Chromium with a temporary executable-path override; the repository audit/E2E assertions were retained. Screenshots were inspected and agent-browser confirmed meaningful home content, no framework overlay and no uncaught page errors. This is local verification; GitHub CI on its configured Node 20 remains a separate check.

## Validation

- Clean `npm ci --no-audit --no-fund`: passed.
- `./.venv/bin/python -m pytest backend/tests/ -q`: passed.
- `npm test` with `--ci --runInBand`: passed; 303 Python tests and 179 Jest tests (21 suites) overall.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed. Build generated all 504 static pages.
- `scripts/courtside_audit.mjs` passed against the production server with the committed artifact: probability/data parity, team following persistence, hypothetical records, filters/Back, clipboard links and refresh failure recovery. Lab checks at 320/390/768/1440 px found zero axe violations, overflow or page errors; the home layout was checked at all four widths.
- Local PNG through `/_next/image`: HTTP 200 with image/png, exercising the patched image stack.

The backend test run did not regenerate a forecast or train a new model. Browser coverage is a smoke/audit of home and lab interactions, not every archived page or live ESPN feed.

## Isolation

Based on main `2bd5d4f8e4d6ef5171db9ea6117bf1edb1e71e54`. Existing draft PR #2 is preserved at `859a85b4f46908b711f766fd100721dd6e9007da`; its branch was not modified. This change is for independent review, with no merge or production deployment performed by the agent.

## Audit snapshot and limitations

`npm audit --json --registry=https://registry.npmjs.org` was run before and after. This is a registry snapshot, not a compromise assessment or a claim that every remaining package is safe. The complete final result is in [security-audit-2026-10-05.json](security-audit-2026-10-05.json).

| Snapshot | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before | 1 | 41 | 0 | 0 | 42 |
| After | 0 | 10 | 1 | 0 | 11 |

Remaining findings include Next's exactly pinned PostCSS 8.4.31 and development glob/YAML parsers. Next is still listed transitively through PostCSS; its targeted RCE advisories are absent. Replacing that internal PostCSS pin would need separate compatibility review. No blanket audit fix, forced major update or dependency override was applied.

Raw local logs, audit inputs, browser harnesses and screenshots are retained in `/workspace/security-evidence-2026-10-05/` in the saved cloud environment.
