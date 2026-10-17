import type { ReactNode } from 'react'

import { StatTile } from '@/components/primitives/StatTile'
import type { GameForecast } from '@/lib/artifacts'
import { num, pct, signed } from '@/lib/format'

/** A readable view of the published forecast, without a new model or AI narrative. */
export function GameOutlook({ game, children }: { game: GameForecast; children?: ReactNode }) {
  const even = game.p_home === game.p_away
  const favourite = game.p_home > game.p_away ? game.home : game.away
  const chance = Math.max(game.p_home, game.p_away)
  return <section id="forecast" aria-labelledby="game-outlook-title" className="card mb-4 scroll-mt-20 p-4 sm:p-5">
    <p className="eyebrow">Pre-game prediction</p>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      <div>
        <h2 id="game-outlook-title" className="text-base sm:text-lg">{even ? 'Evenly matched' : `${favourite.name} favored`}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]"><strong className="numeric mr-2 text-3xl text-[var(--text-primary)]">{pct(chance)}</strong>{even ? 'chance each' : 'chance to win'}</p>
      </div>
      <div className="border-t border-[var(--border-color)] pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
        <p className="text-xs text-[var(--text-secondary)]">Projected score · not a result</p>
        <p className="numeric mt-2 text-xl">{game.away.abbreviation} {Math.round(game.exp_away_score)} <span className="text-[var(--text-tertiary)]">–</span> {game.home.abbreviation} {Math.round(game.exp_home_score)}</p>
      </div>
    </div>
    <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">Either team can win. This pre-game model does not include injuries or confirmed lineups.</p>
    <details id="prediction-details" className="mt-4 scroll-mt-20 border-t border-[var(--border-color)]">
      <summary className="min-h-[44px] cursor-pointer py-3 font-numeric text-xs text-[var(--accent-info)]">Prediction details</summary>
      <p className="mb-4 text-xs leading-relaxed text-[var(--text-secondary)]">The win chances and score below come from the published model. The projected score is an average outcome, not an exact-score prediction; the estimate stays fixed during play.</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile dl label="Home win">{pct(game.p_home)}</StatTile>
        <StatTile dl label="Proj. margin">{signed(game.exp_margin)}</StatTile>
        <StatTile dl label="Proj. total">{num(game.exp_total, 1)}</StatTile>
        <StatTile dl label="Proj. score">{`${Math.round(game.exp_away_score)}–${Math.round(game.exp_home_score)}`}</StatTile>
      </dl>
      {children}
    </details>
  </section>
}
