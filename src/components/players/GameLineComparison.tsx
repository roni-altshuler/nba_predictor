'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useId, useState } from 'react'
import { comparisonLabel, comparisonPair, type ComparisonLine, type ComparisonPair } from '@/lib/gameLineComparison'

const control = 'min-h-[44px] w-full min-w-0 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-3 font-numeric text-xs text-[var(--text-primary)] hover:border-[var(--border-hover)]'

function ComparisonUrlSync({ restore }: { restore: () => void }) {
  const query = useSearchParams().toString()
  useEffect(() => restore(), [query, restore])
  return null
}

/** A same-game reading aid, with no requests, rankings or derived rate stats. */
export function GameLineComparison({ lines, gameDate }: { lines: ComparisonLine[]; gameDate: string }) {
  const [pair, setPair] = useState(() => comparisonPair(lines, null, null))
  const [ready, setReady] = useState(false)
  const restore = useCallback(() => {
    const query = new URLSearchParams(window.location.search)
    setPair(comparisonPair(lines, query.get('compareLeft'), query.get('compareRight')))
    setReady(true)
  }, [lines])
  useEffect(() => {
    restore()
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [restore])

  const choose = (next: ComparisonPair) => {
    const url = new URL(window.location.href)
    url.searchParams.set('compareLeft', next.left)
    url.searchParams.set('compareRight', next.right)
    url.hash = 'game-line-comparison'
    window.history.pushState(null, '', url)
    setPair(next)
  }
  const left = lines.find(line => line.key === pair.left)
  const right = lines.find(line => line.key === pair.right)
  const labels = [...new Set([...(left?.labels ?? []), ...(right?.labels ?? [])])]
  const date = new Date(gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

  return (
    <section id="game-line-comparison" aria-labelledby="game-line-comparison-title" data-ready={ready} className="card scroll-mt-20 overflow-hidden">
      <Suspense fallback={null}><ComparisonUrlSync restore={restore} /></Suspense>
      <div className="border-b border-[var(--border-color)] p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="game-line-comparison-title" className="text-sm">Compare game lines</h2>
          <span className="eyebrow">Final · {date} ET</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">Two players, one completed game. Read their reported lines side by side.</p>
      </div>
      {left && right ? (
        <>
          <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end sm:p-5">
            <LinePicker label="First player" value={pair.left} other={pair.right} lines={lines} onChange={key => choose({ ...pair, left: key })} />
            <button type="button" className={`${control} sm:w-auto`} onClick={() => choose({ left: pair.right, right: pair.left })}>Swap players</button>
            <LinePicker label="Second player" value={pair.right} other={pair.left} lines={lines} onChange={key => choose({ ...pair, right: key })} />
          </div>
          <div className="grid grid-cols-2 gap-4 border-y border-[var(--border-color)] bg-[var(--muted-bg)] p-4 sm:px-5" aria-live="polite" aria-atomic="true">
            <LineSummary line={left} />
            <LineSummary line={right} />
          </div>
          {labels.length ? (
            <table className="w-full table-fixed" aria-label="Selected player game statistics">
              <thead><tr>
                <th scope="col" className="w-[34%] break-words text-left text-xs">{left.name}</th>
                <th scope="col" className="w-[32%] text-center text-[10px]">Game stat</th>
                <th scope="col" className="w-[34%] break-words text-right text-xs">{right.name}</th>
              </tr></thead>
              <tbody>{labels.map(label => <tr key={label}>
                <td className="numeric break-words text-left">{left.stats[label] ?? '—'}</td>
                <th scope="row" className="break-words text-center text-[11px] font-normal text-[var(--text-secondary)]">{comparisonLabel(label)}</th>
                <td className="numeric break-words text-right">{right.stats[label] ?? '—'}</td>
              </tr>)}</tbody>
            </table>
          ) : <p className="p-4 text-sm text-[var(--text-secondary)]">Statistics unavailable for these game lines.</p>}
        </>
      ) : <p role="status" className="p-4 text-sm leading-relaxed text-[var(--text-secondary)]">Comparison unavailable: this box score has fewer than two players with usable provider IDs. Published lines remain below.</p>}
      <p className="border-t border-[var(--border-color)] p-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Source: ESPN final game summary · Sample: 1 game per player. Team names are game-reported; source update time unavailable. Values are as reported, without pace adjustment. A dash means missing or did not play. This game line does not establish player quality or future performance.
      </p>
    </section>
  )
}

function LinePicker({ label, value, other, lines, onChange }: { label: string; value: string; other: string; lines: ComparisonLine[]; onChange: (value: string) => void }) {
  const id = useId()
  const teams = [...new Set(lines.map(line => line.teamId))]
  return <div className="min-w-0">
    <label htmlFor={id} className="eyebrow mb-2 block">{label}</label>
    <select id={id} className={control} value={value} onChange={event => onChange(event.target.value)}>
      {teams.map(team => <optgroup key={team} label={lines.find(line => line.teamId === team)?.reportedTeam ?? 'Team name unavailable'}>
        {lines.filter(line => line.teamId === team).map(line => <option key={line.key} value={line.key} disabled={line.key === other}>{line.name}{line.didNotPlay ? ' · DNP' : ''}</option>)}
      </optgroup>)}
    </select>
  </div>
}

function LineSummary({ line }: { line: ComparisonLine }) {
  return <div className="min-w-0">
    <p className="break-words text-sm font-semibold">{line.name}</p>
    <p className="mt-1 break-words text-[11px] text-[var(--text-secondary)]">{line.reportedTeam ?? 'Game-reported team unavailable'}</p>
    <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{line.didNotPlay ? `Did not play${line.reason ? ` · ${line.reason}` : ' · Reason unavailable'}` : 'Final game line'}</p>
    {line.href ? <Link href={line.href} prefetch={false} className="mt-2 inline-flex min-h-[36px] items-center text-xs text-[var(--accent-info)] underline underline-offset-4" aria-label={`Open ${line.name} game profile`}>Game profile →</Link> : null}
  </div>
}
