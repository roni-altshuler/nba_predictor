import { Suspense } from 'react'

import { MatchupPicker, type ScheduledMeeting } from './MatchupPicker'
import { getGameForecasts } from '@/lib/artifacts'
import { getMatchups } from '@/lib/history'
import { stamp } from '@/lib/format'

export const metadata = { title: 'Head to head' }
export const dynamic = 'force-static'

/**
 * The next real fixture for each ordered pairing, keyed `HOME|AWAY`.
 *
 * A hypothetical matchup is more useful when it can hand the reader the
 * actual game: the picker answers "what if these two played", and this
 * answers "and they do, on the 14th". Built here, on the server, from the
 * schedule the page already ships — the picker stays a pure lookup.
 */
function nextMeetings(): Record<string, ScheduledMeeting> {
  const games = getGameForecasts()?.games ?? []
  const out: Record<string, ScheduledMeeting> = {}
  for (const game of games) {
    const key = `${game.home.abbreviation}|${game.away.abbreviation}`
    // Games arrive in schedule order, so the first one seen is the next one
    // played. Overwriting would leave the LAST meeting of the season here.
    if (!out[key]) {
      out[key] = { id: game.game_id, date: game.date_utc }
    }
  }
  return out
}

export default function PredictPage() {
  const matchups = getMatchups()
  const scheduled = nextMeetings()

  if (!matchups) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No matchup surface published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">build_history</code> to generate one.
        </p>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Head to head</p>
        <h1 className="mt-1 text-2xl">Any two teams</h1>
        <p className="mt-2 font-numeric text-[11px] text-[var(--text-tertiary)]">
          {matchups.matchups.length} ordered pairings · ratings as of{' '}
          {stamp(matchups.generated_at)} · the same model as the game forecasts
        </p>
      </header>

      {/* The picker reads `?home=&away=` with useSearchParams, which on a
          static page renders client-side up to the nearest Suspense
          boundary. The fallback mirrors the picker card's shape so nothing
          jumps when it arrives. */}
      <Suspense fallback={<PickerFallback />}>
        <MatchupPicker data={matchups} scheduled={scheduled} />
      </Suspense>
    </div>
  )
}

function PickerFallback() {
  return (
    <div className="card p-4" aria-busy="true" aria-label="Loading the picker">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <div className="skeleton-shimmer h-[3.75rem]" />
        <div className="skeleton-shimmer h-9 w-16" />
        <div className="skeleton-shimmer h-[3.75rem]" />
      </div>
    </div>
  )
}
