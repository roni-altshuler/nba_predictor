import { MatchupPicker } from './MatchupPicker'
import { getMatchups } from '@/lib/history'
import { stamp } from '@/lib/format'

export const metadata = { title: 'Head to head' }
export const dynamic = 'force-static'

export default function PredictPage() {
  const matchups = getMatchups()

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

      <MatchupPicker data={matchups} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        ratings as of {stamp(matchups.generated_at)}
      </p>
    </div>
  )
}
