# Single-game player exploration · 2026-10-06

Team pages now link to their three most recent completed games from the latest
published season. Completed franchise-game box scores link player and leader
names to `/players/espn/[id]?game=[event]&team=[espn-team]`. DNP names are linked too.
The profile shows the selected game’s supplied statistics, position, jersey and
game-reported team name, and provides a contextual game link and history-aware Back.
The mobile header places the identity beside a compact initials/number plate.
Names remain visible without a portrait or usable ID.

## Identity and coverage

- ESPN athlete IDs survive normalization and leader selection. NBA numeric IDs
  are never substituted for ESPN IDs. Unsupported providers are rejected.
- Warehouse team IDs are separate too: New York is internal team `20`, ESPN
  team `18`. The profile uses the published standings’ explicit `espn_id` mapping.
- Archive names are normalized franchise references, not point-in-time team
  affiliations. `season_2004.json` and `season_2005.json` use Oklahoma City Thunder,
  Brooklyn Nets and New Orleans Pelicans for ESPN IDs `25`, `17` and `3`.
  The profile labels these as **Franchise reference**. **Game-reported team**
  comes only from the matching ESPN box-score participant’s `displayName`; a
  missing response or blank name stays unavailable. The score card explicitly
  labels its normalized franchise codes. No historical name is inferred by date.
- Only a known archived game and mapped participant can reach the existing
  `getEspnBoxScore` reader. Its final summary is force-cached as before. No
  athlete, roster or career endpoint, new dataset, model input or aggregate is added.
- A valid line is selected by provider, athlete ID and ESPN team ID. Missing
  identity, game context, mapping, player line or response gets an explicit
  unavailable state. Missing stats stay `—`; DNP rows retain their supplied reason.
- The UI labels ESPN as the box-score source and the game date as the final-game
  context. Source update time is unavailable. The archive publication date is
  displayed separately and does not imply that ESPN was refreshed at that time.
- All-Star exhibition sides publish warehouse IDs without an ESPN mapping.
  Their names stay visible as plain text; profile linking waits for that mapping.

The committed archive has no athlete index, current roster, complete player
season coverage or career dataset. A populated profile requires the existing
summary reader to return a usable athlete ID and line for a mapped team in the
chosen game. A populated bare-ID profile would additionally need a persisted,
provider-qualified athlete index with source/as-of evidence. Current rosters and
career statistics need their own verified coverage; partial game lines cannot
supply season totals or averages.

## Portrait contract

`AthleteImageAsset` records provider, provider-qualified subject, local asset path,
source URL and verification date, plus permission status, basis, reference and
verification date. The renderer checks the exact subject and evidence, and falls
back after an image error. The verified registry is empty: no athlete images are
downloaded, guessed from CDN patterns or rendered. A future portrait needs an
existing local asset and a verified permission/provenance record for that subject.

## Validation

- 244 frontend tests passed, including leader identity preservation, provider
  collisions, warehouse/provider team mapping, wrong-team and unavailable
  states, DNP, missing cells, image permission and image-error fallback.
- Historical tests use the real committed 2003 and 2004 results (season labels
  2004/2005), with supplied synthetic box-score names for all three franchises.
  They verify that Seattle SuperSonics, New Jersey Nets and New Orleans Hornets
  remain distinct from the normalized franchise reference, that blank names and
  mismatched responses cannot inherit a modern name, and that canonical IDs stay
  unchanged. These names are test inputs; the application has no name-by-year map.
- Lint, TypeScript and the 504-page production build passed. Existing ESPN reads
  were blocked during the local build to avoid requesting new data.
- Actual Chromium QA against an isolated production build passed at 320, 390,
  768 and 1440px: keyboard team → game → player, leader links, DNP, cold game
  fallback, date/team-filtered slate → preview → archived meeting → player → Back,
  browser Back/Forward, unknown context and unsupported namespace. No body
  overflow, unexpected browser errors, portrait requests or WCAG A/AA findings.
- The unmodified production app also passed unavailable-source checks at 320,
  390 and 1440px. Loading announcements and keyboard error/retry recovery passed
  at those widths using temporary delay/failure injection in the isolated copy.
  That injection is absent from the proposed application source.
- Historical browser QA at 320, 390 and 1440px passed six dated franchise cases
  plus missing-name and missing-summary cases at each width, with keyboard game
  links, separate team/franchise labels, Back/Forward, zero overflow and zero
  WCAG A/AA findings. The unmodified app also keeps the 2003 reported name
  unavailable when its summary is unavailable.

Available-view browser tests use **synthetic QA Guard / QA Reserve / QA Historical Guard lines and
athlete IDs**, with committed real game/team context. These tests establish UI
behavior, not real player coverage. The fixture preload lives under
`scripts/qa/`; use it only in an isolated copy, never production. Then run
`QA_BASE=http://127.0.0.1:3151 QA_BROWSER=/usr/bin/chromium node scripts/player_profile_audit.mjs`.
No live player summary or portrait was fetched for this audit.

[Browser results](player-profile-qa-2026-10-06.json) ·
[Fixture desktop](screenshots/player-profile-fixture-desktop.png) ·
[Fixture mobile](screenshots/player-profile-fixture-mobile.png) ·
[Unmodified production unavailable](screenshots/player-profile-unavailable-mobile.png) ·
[Historical fixture desktop](screenshots/player-profile-historical-fixture-desktop.png) ·
[Historical fixture mobile](screenshots/player-profile-historical-fixture-mobile.png) ·
[Historical name unavailable](screenshots/player-profile-historical-name-unavailable-mobile.png)
