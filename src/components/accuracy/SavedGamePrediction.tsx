import Link from 'next/link'

import { pct, stamp } from '@/lib/format'
import type { ArchiveGame } from '@/lib/history'
import { compareTime, timestamp, type TrackRecord } from '@/lib/trackRecord'

/** The ledger's validated first call, never the archive's reconstruction. */
export function SavedGamePrediction({ game, report, teams }: {
  game: ArchiveGame
  report: TrackRecord
  teams: Record<string, { name: string }>
}) {
  const resultKnown = Number.isSafeInteger(game.home_score) && game.home_score >= 0
    && Number.isSafeInteger(game.away_score) && game.away_score >= 0 && game.home_score !== game.away_score
  const homeWon = game.home_score > game.away_score
  const name = (team: string) => teams[team]?.name ?? team
  const sameSeason = report.available && report.season === game.season
  const row = sameSeason ? report.settled.find(pick => pick.id === game.id)
    ?? report.unpicked.find(pick => pick.id === game.id) : undefined
  const matches = row && resultKnown && timestamp(game.date) && timestamp(row.actualStart)
    && compareTime(game.date, row.actualStart) === 0 && row.home === game.home && row.away === game.away
    && row.homeWon === homeWon && (row.probability === 0.5 || typeof row.correct === 'boolean')
  const pick = matches ? row : undefined
  const pending = sameSeason && report.pending?.some(call => call.id === game.id)
  const status = pick ? pick.probability === 0.5 ? 'No winner pick' : pick.correct ? 'Correct' : 'Incorrect'
    : 'Not graded'
  const reason = !sameSeason ? 'Verified pregame evidence for this game is unavailable in the published record. This does not establish that no forecast was saved.'
    : row ? 'The published call and archived result could not be matched. No saved pick or grade is shown here.'
    : pending ? 'Awaiting published scoring: the archive has a result, but this publication has not graded the saved call. Check the awaiting-scoring entries in the model record.'
    : 'No verified saved pick for this game is included in this publication. Missing or excluded evidence is not a loss.'
  const ledger = pick && pick.probability !== 0.5 ? `/accuracy#pick-${encodeURIComponent(pick.id)}` : '/accuracy#published-record'

  return <section id="saved-prediction" aria-label="Saved pregame prediction" className="card mb-6 scroll-mt-20 p-4 sm:p-5">
    <h2 className="text-sm">Saved pregame prediction</h2>
    <dl className="mt-4 grid gap-4 sm:grid-cols-3">
      <div className="min-w-0">
        <dt className="eyebrow">Original saved pick</dt>
        <dd className="mt-1 break-words text-sm text-[var(--text-primary)]">{pick
          ? pick.probability === 0.5 ? 'No favorite · 50/50'
            : <>{name(pick.probability > 0.5 ? pick.home : pick.away)}<span className="block font-numeric">{pct(Math.max(pick.probability, 1 - pick.probability), 1)} win chance</span></>
          : 'Not verified in this publication'}</dd>
      </div>
      <div className="min-w-0">
        <dt className="eyebrow">Actual winner · archive final</dt>
        <dd className="mt-1 break-words text-sm text-[var(--text-primary)]">{resultKnown ? name(homeWon ? game.home : game.away) : 'Result unavailable'}</dd>
      </div>
      <div className="min-w-0">
        <dt className="eyebrow">Published result</dt>
        <dd className={`mt-1 text-sm ${pick && pick.probability !== 0.5 ? pick.correct ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]' : 'text-[var(--text-secondary)]'}`}>{status}</dd>
      </div>
    </dl>
    {pick ? <>
      <p className="mt-4 break-words text-xs leading-relaxed text-[var(--text-secondary)]">Saved {stamp(pick.generatedAt)} · Model {pick.version ?? 'version unavailable'}.</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">Recorded start {stamp(pick.actualStart!)}{report.checkedAt ? ` · Results checked ${stamp(report.checkedAt)}` : ''}.</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{pick.probability === 0.5
        ? 'This saved call had no favorite and is outside the winner-pick percentage.'
        : 'This is the earliest eligible pregame call used by the published record. One result does not establish model quality.'}</p>
    </> : <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">{reason}</p>}
    <Link href={ledger} className="mt-3 inline-flex min-h-[44px] items-center text-xs text-[var(--accent-info)] underline underline-offset-4">{pick && pick.probability !== 0.5 ? 'View this pick in the published record' : 'Open the published model record'}</Link>
  </section>
}
