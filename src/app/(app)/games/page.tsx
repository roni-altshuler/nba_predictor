import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { DailySlate } from '@/components/schedule/DailySlate'
import { SeasonCalendar } from '@/components/schedule/SeasonCalendar'
import {
  getGameForecasts,
  getSeasonProjections,
  groupByWeek,
} from '@/lib/artifacts'
import { stamp } from '@/lib/format'
import { easternDay } from '@/lib/courtside'
import Link from 'next/link'

export const metadata = { title: 'Games' }
export const dynamic = 'force-static'

/** A shareable daily slate leads; weekly calendars mount when requested. */
export default function GamesPage() {
  const forecasts = getGameForecasts()
  const projections = getSeasonProjections()

  if (!forecasts || !forecasts.games.length) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No forecasts published</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">
          Game probabilities are unavailable in this snapshot. Explore the season archive or check back after the next published forecast.
        </p>
        <Link href="/seasons" className="mt-3 inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">Browse past seasons →</Link>
      </div>
    )
  }

  const weeks = groupByWeek(forecasts.games, forecasts.season_start)
  const anchored = weeks[0]?.anchored ?? false

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Season {forecasts.season - 1}–{String(forecasts.season).slice(-2)}</p>
        <h1 className="mt-1 text-2xl sm:text-3xl">Games, one night at a time.</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">Choose a slate. Open a matchup. Compare the published forecast with its evidence.</p>
        <p className="mt-3 font-numeric text-xs text-[var(--text-tertiary)]">Forecast published {stamp(forecasts.generated_at)} · {forecasts.n_games.toLocaleString()} scheduled games</p>
      </header>

      <DailySlate games={forecasts.games} initialDay={easternDay(forecasts.games[0].date_utc)} />

      <SeasonCalendar weeks={weeks} />

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
