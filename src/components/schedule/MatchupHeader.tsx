'use client'

import Link from 'next/link'

import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { BackLink } from '@/components/primitives/BackLink'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast, GameForecasts } from '@/lib/artifacts'
import { easternDay } from '@/lib/courtside'
import { dayLabel, gameTime, stamp } from '@/lib/format'

export function MatchupHeader({ game, forecasts, records }: { game: GameForecast; forecasts: GameForecasts; records: { home?: string; away?: string } }) {
  const day = easternDay(game.date_utc)
  return <header className="mb-6">
    <BackLink href={`/games?date=${day}`} label="Daily slate" className="inline-flex min-h-[44px] items-center gap-2 font-numeric text-xs text-[var(--accent-info)] hover:underline" />
    <div className="card mt-2 p-4 sm:p-6">
      <p className="eyebrow">Matchup preview · {dayLabel(day)} · {gameTime(game.date_utc)}</p>
      <h1 className="mt-3 text-lg leading-relaxed sm:text-2xl">{game.away.name} <span className="text-[var(--text-tertiary)]">at</span> {game.home.name}</h1>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {[game.away, game.home].map((side, index) => <div key={side.team_id} className={index ? 'col-start-3 text-right' : 'col-start-1'}>
          <Link href={`/teams/${side.abbreviation}`} className={`inline-flex min-h-[44px] items-center gap-3 ${index ? 'flex-row-reverse' : ''}`}>
            <TeamLogo logo={side.logo} name={side.name} abbreviation={side.abbreviation} size={44} />
            <span className="numeric text-xl sm:text-3xl">{side.abbreviation}</span>
          </Link>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">{index ? 'Home' : 'Away'}{game.neutral_site ? ' · neutral venue' : ''}</p>
          <p className="mt-1 font-numeric text-xs text-[var(--text-tertiary)]">{(index ? records.home : records.away) ?? 'Record unavailable'}</p>
        </div>)}
        <span className="col-start-2 row-start-1 mt-4 self-start font-numeric text-xs text-[var(--text-tertiary)]" data-score="pending">vs</span>
      </div>
      <div className="mt-5 border-t border-[var(--border-color)] pt-4">
        <p className="eyebrow mb-3">Published win probability</p>
        <ProbabilityBar homeLabel={game.home.abbreviation} awayLabel={game.away.abbreviation} pHome={game.p_home} />
      </div>
      <p className="mt-4 text-xs text-[var(--text-secondary)]">{game.venue ?? 'Venue unavailable'}</p>
      <dl className="mt-4 grid gap-3 border-t border-[var(--border-color)] pt-4 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--text-tertiary)]">Forecast published</dt><dd className="mt-1 font-numeric">{stamp(forecasts.generated_at)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Results used through</dt><dd className="mt-1 font-numeric">{stamp(forecasts.trained_through ?? undefined)}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Pre-game snapshot; injuries and roster changes are not inputs to these probabilities.</p>
    </div>
    <nav aria-label="Matchup sections" className="mt-3 flex flex-wrap gap-2">
      {[['forecast', 'Projection'], ['market', 'Market'], ['availability', 'Availability'], ['context', 'Recent meetings']].map(([id, label]) =>
        <a key={id} href={`#${id}`} onClick={event => {
          const target = document.getElementById(id)
          if (!target) return
          event.preventDefault()
          window.history.replaceState(window.history.state, '', `#${id}`)
          target.tabIndex = -1
          target.scrollIntoView()
          target.focus({ preventScroll: true })
        }} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border-color)] px-3 font-numeric text-xs text-[var(--text-secondary)] hover:border-[var(--border-hover)]">{label}</a>)}
      <Link href="/accuracy" className="inline-flex min-h-[44px] items-center px-3 font-numeric text-xs text-[var(--accent-info)] hover:underline">Model evidence →</Link>
    </nav>
  </header>
}
