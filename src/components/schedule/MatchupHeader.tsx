import Link from 'next/link'

import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { BackLink } from '@/components/primitives/BackLink'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
import { easternDay } from '@/lib/courtside'
import { dayLabel, gameTime, stamp } from '@/lib/format'
import { MatchupSections } from './MatchupSections'

/** Render the preview on the server; only navigation needs client JavaScript. */
export function MatchupHeader({ game, generatedAt, trainedThrough, records }: {
  game: GameForecast
  generatedAt: string
  trainedThrough?: string | null
  records: { home?: string; away?: string }
}) {
  const day = easternDay(game.date_utc)
  return <header className="mb-6">
    <BackLink href={`/games?date=${day}`} label="Daily slate" className="inline-flex min-h-[44px] items-center gap-2 font-numeric text-xs text-[var(--accent-info)] hover:underline" />
    <div className="card mt-2 p-4 sm:p-6">
      <p className="eyebrow">Matchup preview · {dayLabel(day)} · {gameTime(game.date_utc)}</p>
      <h1 className="mt-3 text-lg leading-relaxed sm:text-2xl">{game.away.name} <span className="text-[var(--text-tertiary)]">at</span> {game.home.name}</h1>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {[game.away, game.home].map((side, index) => <div key={side.team_id} className={index ? 'col-start-3 text-right' : 'col-start-1'}>
          <Link href={`/teams/${side.abbreviation}`} className={`inline-flex min-h-[44px] flex-wrap items-center gap-2 sm:gap-3 ${index ? 'flex-row-reverse' : ''}`}>
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
        <div><dt className="text-[var(--text-tertiary)]">Forecast published</dt><dd className="mt-1 font-numeric">{stamp(generatedAt)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Results used through</dt><dd className="mt-1 font-numeric">{stamp(trainedThrough ?? undefined)}</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Pre-game snapshot; injuries and roster changes are not inputs to these probabilities.</p>
    </div>
    <MatchupSections />
  </header>
}
