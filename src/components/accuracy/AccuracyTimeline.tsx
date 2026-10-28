'use client'

import { useId, useState } from 'react'
import { RECENT_WINDOW, type RecordedPick } from '@/lib/trackRecord'
import { stamp } from '@/lib/format'

const W = 680, H = 280, LEFT = 76, RIGHT = 116, TOP = 24, BOTTOM = 68
const percent = (n: number) => `${n.toFixed(1)}%`

export function AccuracyTimeline({ rows }: { rows: RecordedPick[] }) {
  return rows.length ? <Timeline rows={rows} /> : <p className="text-sm text-[var(--text-secondary)]">The timeline starts after the first eligible game settles. There is no accuracy percentage yet.</p>
}

function Timeline({ rows }: { rows: RecordedPick[] }) {
  const [selected, setSelected] = useState(rows.length - 1)
  const id = useId()
  const point = rows[Math.min(selected, rows.length - 1)]
  const firstTime = Date.parse(rows[0].actualStart!), lastTime = Date.parse(rows[rows.length - 1].actualStart!)
  const x = (time: number) => firstTime === lastTime ? LEFT + (W - LEFT - RIGHT) / 2 : LEFT + (time - firstTime) / (lastTime - firstTime) * (W - LEFT - RIGHT)
  const y = (p: number) => TOP + (100 - p) / 100 * (H - TOP - BOTTOM)
  const line = (key: 'accuracy' | 'recentAccuracy') => rows.map((r, i) => `${i ? 'L' : 'M'}${x(Date.parse(r.actualStart!))},${y(r[key]!)}`).join(' ')
  const last = rows[rows.length - 1]
  return <figure className="m-0" aria-labelledby={`${id}-caption`}>
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)]">
      <span className="max-w-full" data-testid="cumulative-latest"><span aria-hidden="true">━━ </span>Cumulative · all settled games · <strong className="font-numeric text-sm text-[var(--text-primary)]">{percent(last.accuracy!)} latest</strong></span>
      <span className="max-w-full" data-testid="recent-latest"><span aria-hidden="true">┄┄ </span>Recent form · last {last.recentSettled} settled games · <strong className="font-numeric text-sm text-[var(--text-primary)]">{percent(last.recentAccuracy!)} latest</strong></span>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[800px] font-numeric" role="img" aria-label={`NBA winner-pick accuracy over calendar time, from 0 to 100 percent. Cumulative ${percent(last.accuracy!)} after ${rows.length} settled games. Recent form ${percent(last.recentAccuracy!)} on ${last.recentSettled} games.`}
      onPointerDown={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const target = (event.clientX - bounds.left) / bounds.width * W
        setSelected(rows.reduce((best, r, i) => Math.abs(x(Date.parse(r.actualStart!)) - target) < Math.abs(x(Date.parse(rows[best].actualStart!)) - target) ? i : best, 0))
      }} style={{ touchAction: 'pan-y' }}>
      {[0, 25, 50, 75, 100].map(value => <g key={value}>
        <line x1={LEFT} x2={W - RIGHT} y1={y(value)} y2={y(value)} stroke="var(--viz-axis)" strokeDasharray="3 3" />
        <text x={LEFT - 7} y={y(value) + 4} textAnchor="end" fill="var(--text-tertiary)" className="text-[24px] sm:text-[13px]">{value}%</text>
      </g>)}
      <path d={line('accuracy')} fill="none" stroke="var(--viz-model)" strokeWidth="2.5" />
      <path d={line('recentAccuracy')} fill="none" stroke="var(--viz-market)" strokeWidth="2.5" strokeDasharray="7 4" />
      {rows.map(r => <g key={r.id}>
        <circle cx={x(Date.parse(r.actualStart!))} cy={y(r.accuracy!)} r="2.5" fill="var(--viz-model)"><title>{`${stamp(r.actualStart)}: ${r.correctSoFar} of ${r.settledSoFar} correct; recent ${r.recentCorrect} of ${r.recentSettled}.`}</title></circle>
        {r.versionChanged ? <line x1={x(Date.parse(r.actualStart!))} x2={x(Date.parse(r.actualStart!))} y1={TOP} y2={H - BOTTOM} stroke="var(--text-tertiary)" strokeDasharray="2 5"><title>{`Saved call version changed: ${r.version}`}</title></line> : null}
      </g>)}
      <line x1={x(Date.parse(point.actualStart!))} x2={x(Date.parse(point.actualStart!))} y1={TOP} y2={H - BOTTOM} stroke="var(--text-primary)" strokeOpacity="0.5" />
      <circle cx={x(Date.parse(point.actualStart!))} cy={y(point.accuracy!)} r="4" fill="var(--viz-model)" stroke="var(--text-primary)" />
      {(firstTime === lastTime ? [firstTime] : [firstTime, (firstTime + lastTime) / 2, lastTime]).map(time => <text key={time} x={x(time)} y={H - BOTTOM + 24} textAnchor="middle" fill="var(--text-tertiary)" className="text-[24px] sm:text-[13px]">{new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })}</text>)}
      <text x={W / 2} y={H - 4} textAnchor="middle" fill="var(--text-tertiary)" className="text-[24px] sm:text-[13px]">Game date · UTC</text>
    </svg>
    <label htmlFor={`${id}-game`} className="mt-3 block text-xs text-[var(--text-secondary)]">Inspect a settled game · slide, tap the chart, or use arrow keys</label>
    <input id={`${id}-game`} type="range" min={1} max={rows.length} value={Math.min(selected + 1, rows.length)} onChange={e => setSelected(Number(e.target.value) - 1)} className="min-h-[44px] w-full" aria-valuetext={`Game ${point.settledSoFar}: ${stamp(point.actualStart)}. Cumulative ${point.correctSoFar} of ${point.settledSoFar} correct. Recent ${point.recentCorrect} of ${point.recentSettled} correct.`} />
    <output htmlFor={`${id}-game`} className="block rounded-sm border border-[var(--border-color)] p-3 text-sm leading-relaxed text-[var(--text-secondary)]" aria-live="polite">
      <strong className="text-[var(--text-primary)]">{stamp(point.actualStart)}</strong> · {point.away} at {point.home}. Cumulative {percent(point.accuracy!)} · {point.correctSoFar} of {point.settledSoFar} correct. Recent form {percent(point.recentAccuracy!)} · {point.recentCorrect} of {point.recentSettled} (up to {RECENT_WINDOW} settled games). Saved model: {point.version ?? 'unavailable'}.
      {' '}<a href={`#pick-${point.id}`} className="inline-flex min-h-[44px] items-center text-[var(--accent-info)] underline underline-offset-4">Inspect this pick in the history</a>
    </output>
    <figcaption id={`${id}-caption`} className="mt-3 text-xs leading-relaxed text-[var(--text-tertiary)]">Every point includes all eligible results up to that game. Recent form uses at most the last {RECENT_WINDOW} settled games, including the selected game; its actual count is shown. Partial weeks are not averaged. Lines can fall as well as rise. Version marks indicate a change between recorded calls, not release dates or proof that an update helped. The full history below provides the same counts without using the chart.</figcaption>
  </figure>
}
