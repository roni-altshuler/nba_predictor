import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { GameCard } from '@/components/forecast/GameCard'
import {
  getGameForecasts,
  getSeasonProjections,
  groupByDay,
} from '@/lib/artifacts'
import { dayLabel, stamp } from '@/lib/format'

export const metadata = { title: 'Games' }
export const dynamic = 'force-static'

// Six days at a time. A full 82-game schedule is 1,200 cards and rendering
// them all makes the page unusable on a phone; six slates is about a week,
// which is the horizon anyone plans around.
const DAYS_SHOWN = 6

export default function GamesPage() {
  const forecasts = getGameForecasts()
  const projections = getSeasonProjections()

  if (!forecasts) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No forecasts published</h1>
      </div>
    )
  }

  const days = groupByDay(forecasts.games).slice(0, DAYS_SHOWN)
  const remaining = groupByDay(forecasts.games).length - days.length

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Season {forecasts.season}</p>
        <h1 className="mt-1 text-2xl">Upcoming games</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {forecasts.n_games.toLocaleString()} games remaining.{' '}
          {forecasts.n_priced.toLocaleString()} carry a sportsbook line, and{' '}
          {forecasts.n_flagged.toLocaleString()} show an edge above the{' '}
          {(forecasts.min_edge * 100).toFixed(0)}% floor.
          {forecasts.n_priced === 0
            ? ' No lines are published this far out, so the value surface is empty rather than zero.'
            : ''}
        </p>
      </header>

      {days.map(([day, games]) => (
        <section key={day} className="mb-8">
          <h2 className="mb-3 text-sm">{dayLabel(day)}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {games.map((game) => (
              <GameCard key={game.game_id} game={game} />
            ))}
          </div>
        </section>
      ))}

      {remaining > 0 ? (
        <p className="mb-6 text-[11px] text-[var(--text-tertiary)]">
          {remaining} further slates are forecast but not rendered here — six
          days at a time keeps this page readable on a phone.
        </p>
      ) : null}

      <EvidencePanel measured={projections?.measured} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {forecasts.model_version} · generated {stamp(forecasts.generated_at)}
      </p>
    </div>
  )
}
