import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { GameCard } from '@/components/forecast/GameCard'
import {
  getGameForecasts,
  getSeasonProjections,
  groupByWeek,
  type GameWeek,
} from '@/lib/artifacts'
import { dayLabel, stamp } from '@/lib/format'

export const metadata = { title: 'Games' }
export const dynamic = 'force-static'

/*
 * Organised by NBA WEEK, which is the unit the league itself schedules in.
 *
 * A day is a slate; a week is a schedule. Every argument about rest,
 * back-to-backs and travel is framed in weeks, the league publishes its
 * calendar as "Week 1" and "Week 2", and a reader planning anything is
 * planning around one. The previous version showed six days and then
 * stopped, which answered "what is on tonight" and nothing else.
 *
 * The current week renders open and the rest are `<details>`: 1,200 cards in
 * the DOM at once is unusable on a phone, and collapsing them keeps every
 * week one click away AND still present for in-page search. Two weeks open
 * was the first attempt and made the landing view ninety cards long.
 */
const WEEKS_OPEN = 1

export default function GamesPage() {
  const forecasts = getGameForecasts()
  const projections = getSeasonProjections()

  if (!forecasts) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No forecasts published</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">
          The pipeline has not produced <code>game_forecasts.json</code> yet.
        </p>
      </div>
    )
  }

  const weeks = groupByWeek(forecasts.games, forecasts.season_start)
  const anchored = weeks[0]?.anchored ?? false

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Season {forecasts.season}</p>
        <h1 className="mt-1 text-2xl">The schedule</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {forecasts.n_games.toLocaleString()} games across{' '}
          {weeks.length} weeks.{' '}
          {forecasts.n_priced.toLocaleString()} carry a sportsbook line, and{' '}
          {forecasts.n_flagged.toLocaleString()} show an edge above the{' '}
          {(forecasts.min_edge * 100).toFixed(0)}% floor.
          {forecasts.n_priced === 0
            ? ' No lines are published this far out, so the value surface is empty rather than zero.'
            : ''}{' '}
          Every card opens the full match detail.
        </p>
      </header>

      {weeks.length > 1 ? (
        <nav aria-label="Jump to week" className="mb-6">
          <ul className="flex flex-wrap gap-1.5">
            {weeks.map((week) => (
              <li key={week.week}>
                <a
                  href={`#week-${week.week}`}
                  className="inline-flex min-h-[32px] items-center rounded-sm border border-[var(--border-color)] px-2.5 font-numeric text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
                >
                  {week.week}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {weeks.map((week, index) => (
        <WeekSection
          key={week.week}
          week={week}
          open={index < WEEKS_OPEN}
        />
      ))}

      {!anchored ? (
        <p className="mb-6 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Week numbers are counted from the earliest fixture published here
          rather than from the season opener, because the forecast artifact
          carries no opening date. Republish it with a current
          <code className="font-numeric"> forecast_season </code>
          run to anchor them.
        </p>
      ) : null}

      <EvidencePanel measured={projections?.measured} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {forecasts.model_version} · generated {stamp(forecasts.generated_at)}
      </p>
    </div>
  )
}

function WeekSection({ week, open }: { week: GameWeek; open: boolean }) {
  return (
    <details
      id={`week-${week.week}`}
      open={open}
      className="mb-4 scroll-mt-4"
    >
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border-color)] py-2">
        <span className="text-sm text-[var(--text-primary)]">
          Week {week.week}
        </span>
        <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
          {range(week.start, week.end)}
        </span>
        <span className="ml-auto font-numeric text-[11px] text-[var(--text-tertiary)]">
          {week.games} {week.games === 1 ? 'game' : 'games'}
        </span>
      </summary>

      {week.days.map(([day, games]) => (
        <section key={day} className="mt-4">
          <h3 className="mb-3 font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            {dayLabel(day)}
            <span className="text-[var(--text-tertiary)]">
              {' · '}
              {games.length} {games.length === 1 ? 'game' : 'games'}
            </span>
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {games.map((game) => (
              <GameCard key={game.game_id} game={game} />
            ))}
          </div>
        </section>
      ))}
    </details>
  )
}

function range(start: string, end: string): string {
  const format = (day: string, withYear: boolean) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    })
  return `${format(start, false)} – ${format(end, true)}`
}
