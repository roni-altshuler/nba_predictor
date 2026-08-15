import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { WeekCalendar } from '@/components/schedule/WeekCalendar'
import {
  getGameForecasts,
  getSeasonProjections,
  groupByWeek,
  type GameWeek,
} from '@/lib/artifacts'
import { stamp } from '@/lib/format'

export const metadata = { title: 'Games' }
export const dynamic = 'force-static'

/*
 * Organised by NBA WEEK, which is the unit the league itself schedules in,
 * and drawn as a CALENDAR rather than a list.
 *
 * A day is a slate; a week is a schedule. Every argument about rest,
 * back-to-backs and travel is framed in weeks, the league publishes its
 * calendar as "Week 1" and "Week 2", and a reader planning anything is
 * planning around one.
 *
 * The list form was the real problem though. Forty-odd games a week at one
 * forecast card each is a page you scroll for a minute to read a single
 * week; the calendar puts the whole week on one screen and moves the detail
 * to the game page, which has room for it. See `WeekCalendar`.
 *
 * The current week renders open and the rest are `<details>`, so every week
 * is one click away AND still in the DOM for in-page search.
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
          Every game opens its full match detail.
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

      <WeekCalendar week={week} />
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
