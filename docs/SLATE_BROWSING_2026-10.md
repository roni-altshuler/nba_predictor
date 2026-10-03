# Daily slate and matchup browsing

The Games page now leads with one Eastern-time slate. The date rail, native date
picker, previous/next published slate and franchise filter share their selection
in `?date=YYYY-MM-DD&team=CODE`. Browser history restores those selections. An
empty day stays empty and offers the next published slate; it does not invent a
game, score or live status.

Game cards open the existing matchup route. Upcoming matchup headers show full
team names, season-labelled records, both published win probabilities, venue,
forecast publication time and the results cutoff. Section links move keyboard
focus without adding extra history entries, so Back returns to the slate. A cold
game link has a canonical parent for the correct Eastern day.

Weekly calendars remain available in a secondary disclosure. Their game chips
mount only when a week is expanded. The initial page therefore avoids rendering
all 1,200 chips hidden inside collapsed weeks. Historical evidence remains
visible, and missing market/availability information remains explicit.
The evidence panel names the historical market without implying independently
verified closing timestamps. Its stored sample counts and scores are unchanged.

The [NBA games calendar](https://www.nba.com/games) informed date-first browsing.
Hardwood retains its existing walnut surfaces, hairlines, numeric typography,
team marks and semantic colours. No external UI code or new dependency was added.

## Verification

- Four new regressions cover Eastern-day grouping, real game links, shared empty
  views and recovery, URL/history restoration, invalid dates and unknown teams.
  They use three frozen public opening-day rows from the October 2 artifact, so
  subsequent daily publication does not change the regression cases.
- Repository lint and TypeScript passed. The full unit run passed 183 tests;
  the four new regressions were rerun after the calendar refinement.
- Local Edge checks at 390/768/1440 passed date/team controls, keyboard game
  navigation, section focus, Back, empty recovery and weekly expansion, with no
  page overflow or runtime errors. Whole pages were captured and inspected.
- The actual October 2 forecast and committed history were used. The upcoming
  game rendered the existing missing-availability state. Active-game score
  polling and successful injury responses were not established by these checks.
- Full production build and broader checks are delegated to the existing PR CI
  to keep this laptop pass lightweight; consult the PR's exact-head results.

These captures show the verified flow. The shared footer wording was subsequently
aligned with the historical-market label; that copy change preserves its layout.

![Daily slate on desktop](screenshots/slate-desktop.png)
![Daily slate on a phone](screenshots/slate-mobile.png)
![Matchup preview on a phone](screenshots/matchup-mobile.png)

## Remaining model work

This changes browsing, not forecasting. Probabilities retain their published
values. Injury/roster coverage, prospective evaluation, horizon cohorts and
calibration evidence require separate measured work; no accuracy gain is claimed.
