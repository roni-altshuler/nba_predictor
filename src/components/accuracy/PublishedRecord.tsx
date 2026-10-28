import Link from 'next/link'
import { stamp } from '@/lib/format'
import { RECENT_WINDOW, type RecordedPick, type TrackRecord } from '@/lib/trackRecord'
import { AccuracyTimeline } from './AccuracyTimeline'

const percent = (value: number) => `${value.toFixed(1)}%`
const pickTeam = (row: RecordedPick) => row.probability === 0.5 ? 'No favorite' : row.probability > 0.5 ? row.home : row.away
const pickChance = (row: RecordedPick) => percent(100 * Math.max(row.probability, 1 - row.probability))

export function PublishedRecord({ report, compact = false }: { report: TrackRecord; compact?: boolean }) {
  const settled = report.settled.length
  const period = settled ? `${stamp(report.settled[0].actualStart)} – ${stamp(report.settled[settled - 1].actualStart)}` : 'No eligible results yet'
  return <section id={compact ? 'home-record' : 'published-record'} className="mb-8 scroll-mt-20" aria-label="Published NBA model track record">
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">Model track record</h2>
        <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-info)]">Pregame calls · {report.season ? `${report.season - 1}–${String(report.season).slice(2)} NBA` : 'season unavailable'}</span>
      </div>
      <p className="mt-3 font-numeric text-2xl text-[var(--text-primary)] sm:text-3xl" data-testid="record-headline">
        {!report.available ? 'Record unavailable' : report.accuracy === null ? 'Not yet scored' : `${percent(report.accuracy)} correct`}
      </p>
      {report.available ? <p className="mt-2 text-sm text-[var(--text-secondary)]" data-testid="record-count">
        {settled ? `${report.correct.toLocaleString()} of ${settled.toLocaleString()} settled games` : '0 eligible settled games · no accuracy percentage yet'}
        {' · '}{report.pending === null ? 'pending count unavailable' : `${report.pending.length.toLocaleString()} awaiting a scored result`}
        {report.unpicked.length ? ` · ${report.unpicked.length} settled 50/50 calls outside the percentage` : ''}
      </p> : <p className="mt-2 text-sm text-[var(--text-secondary)]">A verified prospective record is unavailable. Historical backtests are kept separate.</p>}
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Winner-pick accuracy counts how often the saved pick won. A percentage describes these games; it does not guarantee the next result or promise improvement.</p>
      {report.checkedAt ? <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">Results checked {stamp(report.checkedAt)}. Published updates can lag completed games.</p> : null}
      {compact ? <Link href="/accuracy#published-record" className="mt-2 inline-flex min-h-[44px] items-center font-numeric text-xs text-[var(--accent-info)] underline underline-offset-4">Timeline &amp; every saved pick →</Link> : null}
    </div>
    {!compact && report.available ? <>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Settled period · {period}. Whole-season record; no hand-picked date window.</p>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{report.missingCoverage === null
        ? 'Completed-game coverage is unavailable in this publication: games without an eligible saved call are outside this record, and their count is unknown.'
        : `Coverage: ${(settled + report.unpicked.length).toLocaleString()} of ${report.completedCoverage!.toLocaleString()} completed games have an eligible pregame call. ${report.missingCoverage.toLocaleString()} without one are excluded.`}</p>
      {report.unpicked.length ? <p className="mt-2 text-xs text-[var(--text-secondary)]">{report.unpicked.length} settled 50/50 calls had no favorite. They are listed below and excluded from the winner-pick percentage.</p> : null}
      {report.excluded ? <p className="mt-2 text-xs text-[var(--accent-warn)]">{report.excluded.toLocaleString()} evidence rows excluded: missing or conflicting provenance, invalid results or duplicate events. They do not count as correct, incorrect or pending.</p> : null}
      <section className="card mt-5 p-4" aria-label="Accuracy over the season">
        <h3 className="mb-4 text-sm">Accuracy over the season</h3>
        <AccuracyTimeline rows={report.settled} />
      </section>
      <details className="mt-4 border-y border-[var(--border-color)] text-xs text-[var(--text-secondary)]">
        <summary className="min-h-[44px] cursor-pointer py-3 font-numeric">How this record is counted</summary>
        <div className="space-y-3 pb-4 leading-relaxed">
          <p>One pick per game, using the earliest timestamped forecast saved before both the scheduled tip-off and the recorded actual start. It can be weeks or months early and can differ from today&apos;s game outlook. Later forecasts never replace it in this record.</p>
          <p>The pick is the team with the higher saved win chance. An exact 50/50 call has no favorite, so it is listed separately and contributes neither a correct pick nor a game to this percentage. The existing deeper probability scorer keeps its half-credit rule for these calls.</p>
          <p>Scope: this NBA season&apos;s regular season, play-in and playoffs, including the NBA Cup final, between NBA franchises. Only confirmed, non-tied results checked by this publication count. Preseason exhibitions, All-Star/non-franchise games and historical reconstructions are excluded.</p>
          <p>Cumulative accuracy is total correct divided by total eligible settled games, from the first result of this season. Recent form is correct divided by the actual number in the latest {RECENT_WINDOW} graded settled games, or fewer until {RECENT_WINDOW} exist. Percentages round to one decimal; counts are exact. Same-time games are ordered by game ID. Dates and stamps are UTC; weeks with different game counts are never averaged.</p>
          <p>Unknown timestamps, invalid probabilities, conflicting copies and unverified outcomes are excluded. Pending means a saved pregame call has no scored result in this publication; it does not mean the game cannot already have finished. A missing forecast never becomes a loss or a correct pick. Compare records only with the same sport, event scope, selection rule and period.</p>
        </div>
      </details>
      <section className="mt-6">
        <h3 className="mb-3 text-sm">Every settled pick &amp; result</h3>
        {!settled ? <p className="text-sm text-[var(--text-secondary)]">No eligible results to list yet. Saved upcoming calls remain separate below.</p> : <div className="card max-h-[36rem] overflow-auto" tabIndex={0} role="region" aria-label="All settled NBA picks and cumulative and recent counts">
          <table className="min-w-[68rem]">
            <caption className="p-3 text-left text-xs text-[var(--text-secondary)]">All {settled.toLocaleString()} eligible settled picks, earliest result first. Each row reconciles with the timeline.</caption>
            <thead><tr><th scope="col">Game · actual start</th><th scope="col">Saved pick · chance</th><th scope="col">Result</th><th scope="col">Cumulative correct</th><th scope="col">Recent form · up to {RECENT_WINDOW}</th><th scope="col">Saved before tip-off · model</th></tr></thead>
            <tbody>{report.settled.map(row => <tr id={`pick-${row.id}`} key={row.id} tabIndex={-1} className="scroll-mt-20">
              <td><Link href={`/games/${encodeURIComponent(row.id)}`} className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] underline underline-offset-4">{row.away} at {row.home}</Link><span className="block text-[10px]">{stamp(row.actualStart)}</span></td>
              <td>{pickTeam(row)} · {pickChance(row)}</td>
              <td><strong className="text-[var(--text-primary)]">{row.correct ? 'Correct' : 'Incorrect'}</strong><span className="block text-[10px]">{row.homeWon ? row.home : row.away} won</span></td>
              <td className="numeric">{row.correctSoFar} of {row.settledSoFar} · {percent(row.accuracy!)}</td>
              <td className="numeric">{row.recentCorrect} of {row.recentSettled} · {percent(row.recentAccuracy!)}</td>
              <td>{stamp(row.generatedAt)}<span className="block text-[10px]">{row.version ?? 'Model version unavailable'} · {((Date.parse(row.actualStart!) - Date.parse(row.generatedAt)) / 36e5).toFixed(1)} hours before start</span></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      {report.unpicked.length ? <details className="mt-5 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)]">
        <summary className="min-h-[44px] cursor-pointer py-3 font-numeric">Settled 50/50 calls · no winner pick ({report.unpicked.length})</summary>
        <ul className="space-y-3 pb-4">{report.unpicked.map(row => <li key={row.id}><Link className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] underline" href={`/games/${encodeURIComponent(row.id)}`}>{row.away} at {row.home}</Link> · {stamp(row.actualStart)} · No favorite (50/50) · {row.homeWon ? row.home : row.away} won. Saved {stamp(row.generatedAt)} · {row.version ?? 'Model version unavailable'}.</li>)}</ul>
      </details> : null}
      <details className="mt-5 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)]">
        <summary className="min-h-[44px] cursor-pointer py-3 font-numeric">Saved calls awaiting a scored result ({report.pending === null ? 'count unavailable' : report.pending.length.toLocaleString()})</summary>
        {report.pending === null ? <p className="pb-4">The saved-call log is unavailable or incomplete. A zero pending count cannot be inferred.</p> : !report.pending.length ? <p className="pb-4">No unscored eligible calls in the saved log.</p> : <div className="card max-h-[32rem] overflow-auto" tabIndex={0} role="region" aria-label="Every saved NBA call awaiting a scored result">
          <table className="min-w-[48rem]"><caption className="p-3 text-left">All {report.pending.length.toLocaleString()} saved unscored calls. No outcome has been inferred.</caption>
            <thead><tr><th scope="col">Game · saved tip-off</th><th scope="col">Saved pick · chance</th><th scope="col">Saved at · model</th><th scope="col">Status</th></tr></thead>
            <tbody>{report.pending.map(row => <tr key={row.id}><td><Link href={`/games/${encodeURIComponent(row.id)}`} className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] underline underline-offset-4">{row.away} at {row.home}</Link><span className="block text-[10px]">{stamp(row.tipoff)}</span></td><td>{pickTeam(row)} · {pickChance(row)}</td><td>{stamp(row.generatedAt)}<span className="block text-[10px]">{row.version ?? 'Model version unavailable'}</span></td><td>Awaiting scored result</td></tr>)}</tbody>
          </table>
        </div>}
      </details>
    </> : null}
  </section>
}
