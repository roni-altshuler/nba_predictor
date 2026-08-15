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
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Every one of the {matchups.matchups.length} ordered pairings at
          current ratings, computed once and shipped with the page. The same
          model that produces the game forecasts produces these, so the two
          cannot disagree.
        </p>
      </header>

      <MatchupPicker data={matchups} scheduled={scheduled} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        ratings as of {stamp(matchups.generated_at)}
      </p>
    </div>
  )
}
