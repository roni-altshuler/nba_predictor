# Hardwood quality priorities — October 2026

This is a proposed sequence. The app already has games/team pages, season
projections, playoff brackets, ratings, archives, a Forecast Lab and evidence.

Reference: [NBA.com](https://www.nba.com/) foregrounds schedules, teams,
standings and statistics. Use basketball's hierarchy and Hardwood's own assets.

1. **Preserve publication history.** This pass stops automatic full rebuilds
   after failed downloads. Next, retain every forecast horizon snapshot across
   recovery and show forecast/result/injury update times separately. Acceptance:
   outage/rebuild tests retain early and late forecasts; missing sources remain
   visible. Preseason zero-live samples stay empty until results exist.
2. **Evaluate by time and context.** Hold future games/seasons out; fit
   calibration on training data and pair margin/Elo/market rows on identical
   games. Score Brier/log loss, spread/total error and calibration by horizon,
   rest/back-to-back context and playoff series. Require an ablation and paired
   uncertainty interval before promoting an injury/player feature.
3. **Make the daily slate the main path.** Preserve date/team selection across
   game drilldown and back. Lead with score/status and probability, then
   distributions and dated injury context. Acceptance: mobile/keyboard flows
   retain selection; missing lines/injuries and unavailable forecasts are distinct;
   displayed probabilities link to their measured evidence.

Performance/accessibility baselines precede visual expansion. No player model,
accuracy gain or completed redesign is asserted here.
