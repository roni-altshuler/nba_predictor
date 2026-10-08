'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useId, useState } from 'react'
import { seasonLabel, shootingMetrics, shootingSelection, type ShootingContext, type ShootingRate, type ShootingSample, type ShootingTeam } from '@/lib/shootingContext'

const control = 'min-h-[44px] w-full min-w-0 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-3 font-numeric text-xs text-[var(--text-primary)] hover:border-[var(--border-hover)]'
const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

function QuerySync({ restore }: { restore: () => void }) {
  const query = useSearchParams().toString()
  useEffect(() => restore(), [query, restore])
  return null
}

export function TeamShootingContext({ data }: { data: ShootingContext }) {
  const id = useId()
  const [selection, setSelection] = useState(() => shootingSelection(data, null, null))
  const [ready, setReady] = useState(false)
  const restore = useCallback(() => {
    const query = new URLSearchParams(window.location.search)
    setSelection(shootingSelection(data, query.get('scoutSeason'), query.get('scoutWindow')))
    setReady(true)
  }, [data])
  useEffect(() => { restore(); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore) }, [restore])
  const choose = (next: typeof selection) => {
    const url = new URL(window.location.href)
    url.searchParams.set('scoutSeason', String(next.season))
    url.searchParams.set('scoutWindow', String(next.window))
    url.hash = 'shooting-context'
    window.history.pushState(null, '', url)
    setSelection(next)
  }
  const scope = data.scopes.find(value => value.season === selection.season) ?? data.scopes[0]
  const prior = selection.season !== data.gameSeason
  const empty = scope.teams.every(team => team.samples[selection.window].results.length === 0)
  return <section id="shooting-context" aria-labelledby="shooting-context-title" data-ready={ready} className="card mb-6 scroll-mt-20 overflow-hidden">
    <Suspense fallback={null}><QuerySync restore={restore} /></Suspense>
    <div className="border-b border-[var(--border-color)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="shooting-context-title" className="text-sm">Shooting context</h2>
        <span className="eyebrow">Before {date(data.gameDate)} ET</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">Compare how these teams shot and what their opponents attempted in earlier games.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label htmlFor={`${id}-season`} className="eyebrow mb-2 block">Season sample</label>
          <select id={`${id}-season`} className={control} value={selection.season} onChange={event => choose({ ...selection, season: Number(event.target.value) })}>
            {data.scopes.map(value => <option key={value.season} value={value.season}>{seasonLabel(value.season)} · {value.season === data.gameSeason ? 'game season' : 'prior season'}</option>)}
          </select>
        </div>
        <div><label htmlFor={`${id}-window`} className="eyebrow mb-2 block">Recent games</label>
          <select id={`${id}-window`} className={control} value={selection.window} onChange={event => choose({ ...selection, window: event.target.value === '5' ? 5 : 10 })}>
            <option value="5">Last 5 eligible games</option><option value="10">Last 10 eligible games</option>
          </select>
        </div>
      </div>
      <p role="status" className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{prior ? 'Prior-season reference' : 'Game-season sample'} · {seasonLabel(selection.season)} · up to {selection.window} games per team. Regular season, Cup, play-in and playoffs; all venues, overtime included.</p>
      {prior ? <p className="mt-2 text-[11px] text-[var(--accent-warn)]">Earlier season, different roster context. These are team results, not current player estimates.</p> : null}
    </div>
    {empty ? <div className="p-4 sm:p-5">
      <p className="text-sm text-[var(--text-secondary)]">{scope.available ? 'No eligible earlier games for these teams in this season sample.' : `No ${seasonLabel(scope.season)} season archive is available.`}</p>
      {!prior && data.scopes[1]?.available ? <button type="button" className={`${control} mt-3 sm:w-auto`} onClick={() => choose({ ...selection, season: data.scopes[1].season })}>View prior-season reference</button> : null}
    </div> : <div className="grid md:grid-cols-2">{scope.teams.map(team => <TeamSample key={team.id} team={team} sample={team.samples[selection.window]} />)}</div>}
    <details className="border-t border-[var(--border-color)] p-4 sm:p-5">
      <summary className="min-h-[32px] cursor-pointer font-numeric text-xs text-[var(--accent-info)]">How to read these numbers</summary>
      <ul className="mt-3 space-y-2 text-xs text-[var(--text-secondary)]">{shootingMetrics.map(metric => <li key={metric.key}><strong>{metric.label}:</strong> {metric.formula}{metric.key !== 'freeThrows' ? ', shown as a percentage.' : '.'}</li>)}</ul>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">Counts are summed before division. Each rate uses only games with valid required columns; coverage and field-goal attempts appear under the value. A dash means no valid denominator. Effective FG credits the extra point from a three; it is not shot quality. FT attempts per 100 field-goal attempts is not free-throw accuracy.</p>
    </details>
    <p className="border-t border-[var(--border-color)] p-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">Source: ESPN team boxes · Archive built {data.generatedAt ? date(data.generatedAt) + ' ET' : 'at an unavailable time'}. Reconstructed from final boxes with strictly earlier tip-offs; capture and final-whistle times are unavailable. No archived pre-game publication, pace, opponent-strength or roster adjustment. These summaries do not change forecast probabilities.</p>
  </section>
}

function TeamSample({ team, sample }: { team: ShootingTeam; sample: ShootingSample }) {
  const results = sample.results
  return <div className="min-w-0 border-b border-[var(--border-color)] p-4 last:border-b-0 md:border-b-0 md:first:border-r sm:p-5" role="group" aria-label={`${team.abbreviation} shooting sample`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm">{team.abbreviation}</h3><span className="font-numeric text-[11px] text-[var(--text-secondary)]">{results.length} games</span>
    </div>
    <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{team.name} · normalized franchise</p>
    {results.length ? <>
      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">{date(results[results.length - 1].date)} – {date(results[0].date)} ET</p>
      <table className="mt-3 w-full table-fixed" aria-label={`${team.abbreviation} recent shooting rates`}>
        <thead><tr><th scope="col" className="w-[38%] !px-0 text-left">Metric</th><th scope="col" className="!px-1 text-right">Team</th><th scope="col" className="!px-0 text-right">Opponents</th></tr></thead>
        <tbody>{shootingMetrics.map(metric => <tr key={metric.key}>
          <th scope="row" className="!px-0 text-left text-[11px] font-normal text-[var(--text-secondary)]">{metric.label}</th>
          <td className="!px-1 text-right"><Rate rate={sample.offense[metric.key]} total={results.length} percent={metric.key !== 'freeThrows'} /></td>
          <td className="!px-0 text-right"><Rate rate={sample.opponent[metric.key]} total={results.length} percent={metric.key !== 'freeThrows'} /></td>
        </tr>)}</tbody>
      </table>
      <details className="mt-4">
        <summary className="min-h-[32px] cursor-pointer font-numeric text-xs text-[var(--accent-info)]">Included games ({results.length})</summary>
        <ol className="mt-2 divide-y divide-[var(--border-color)]">{results.map(result => <li key={result.id}>
          <Link href={`/games/${result.id}`} prefetch={false} className="block min-h-[44px] py-2 text-xs text-[var(--accent-info)] underline underline-offset-4">
            {date(result.date)} ET · {result.home ? 'vs' : 'at'} {result.opponent} · {result.scored}–{result.allowed}
            <span className="mt-1 block text-[10px] text-[var(--text-secondary)]">{result.phase}{result.overtime ? ` · ${result.overtime} OT` : ''}</span>
          </Link>
        </li>)}</ol>
      </details>
    </> : <p className="mt-3 text-xs text-[var(--text-secondary)]">No eligible earlier games for this team.</p>}
  </div>
}

function Rate({ rate, total, percent }: { rate: ShootingRate; total: number; percent: boolean }) {
  return <><span className="numeric text-base">{rate.value === null ? '—' : `${(100 * rate.value).toFixed(1)}${percent ? '%' : ''}`}</span>
    <span className="mt-1 block font-numeric text-[9px] leading-relaxed text-[var(--text-tertiary)]">{rate.games}/{total} games<br />{rate.attempts} FG att.</span></>
}
