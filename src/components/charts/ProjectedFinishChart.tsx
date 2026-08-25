'use client'

import { pct } from '@/lib/format'

import {
  ChartEmptyState,
  ChartTooltip,
  HighlightRing,
  useChartHover,
} from './hover'

/**
 * Projected wins with the 10th-to-90th percentile band, one row per club.
 *
 * **The point of this chart is the overlap, not the ranking.** The standings
 * table beside it already gives every exact number; what a table cannot show
 * is that six teams' bands sit almost entirely on top of each other, so the
 * ordering between them is close to meaningless this far out. A projection
 * printed as a ranked list invites a reader to believe the ranking. Printed
 * as ranges, it tells them what it actually knows.
 *
 * One hue, because this is magnitude and identity comes from the axis label
 * — the dataviz rule is that a categorical palette is for series that need
 * telling apart, and these do not. The playoff cut is drawn as a reference
 * rather than as colour on the rows, so nothing is encoded in hue alone.
 */

/* Sized for the phone rendering: the 640-unit viewBox scales to ~343px at
   375px width, so row and axis text is 12 — the old 9-10px landed near 5px
   effective. Row height rises with it so the type still has air. */
const ROW_H = 21
const PAD = { top: 24, right: 56, bottom: 8, left: 50 }
const W = 640
const AXIS_FONT = 12

export interface FinishRow {
  abbreviation: string
  name: string
  wins: number
  low: number
  high: number
  /** Playoff probability — drives the row's emphasis, with the value shown. */
  p_playoffs: number
}

interface ProjectedFinishProps {
  rows: FinishRow[]
  label: string
}

export function ProjectedFinishChart({ rows, label }: ProjectedFinishProps) {
  if (rows.length < 2) {
    return (
      <ChartEmptyState>
        No projected finish published for the {label}.
      </ChartEmptyState>
    )
  }
  return <FinishFigure rows={rows} label={label} />
}

/** The drawn chart — split out so the hover hook sits below the early return. */
function FinishFigure({ rows, label }: ProjectedFinishProps) {
  const ordered = [...rows].sort((a, b) => b.wins - a.wins)
  const lo = Math.max(0, Math.floor(Math.min(...ordered.map((r) => r.low)) - 2))
  const hi = Math.min(82, Math.ceil(Math.max(...ordered.map((r) => r.high)) + 2))
  const span = Math.max(1, hi - lo)

  const plotW = W - PAD.left - PAD.right
  const height = PAD.top + ordered.length * ROW_H + PAD.bottom
  const x = (wins: number) => PAD.left + ((wins - lo) / span) * plotW
  const y = (index: number) => PAD.top + index * ROW_H + ROW_H / 2

  const ticks = axisTicks(lo, hi)

  // Hover: rows are the marks here, so the pointer snaps to the nearest row
  // and the tooltip carries the full claim — mean wins, the 10th–90th band,
  // and the playoff probability that drives the row's emphasis.
  const { containerRef, active, svgProps } = useChartHover(W, (vx, vy) => {
    if (vy < PAD.top - 4 || vy > PAD.top + ordered.length * ROW_H + 4) {
      return null
    }
    const index = Math.min(
      ordered.length - 1,
      Math.max(0, Math.floor((vy - PAD.top) / ROW_H)),
    )
    const row = ordered[index]
    return {
      x: x(row.wins),
      y: y(index),
      title: row.name,
      lines: [
        { label: 'mean wins', value: row.wins.toFixed(1) },
        {
          label: '10th–90th',
          value: `${Math.round(row.low)}–${Math.round(row.high)}`,
        },
        { label: 'playoffs', value: pct(row.p_playoffs, 0), muted: true },
      ],
    }
  })

  return (
    <figure className="m-0">
      <div ref={containerRef} className="relative max-w-[720px]">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        {...svgProps}
        aria-label={`${label} projected wins. ${ordered
          .map(
            (r) =>
              `${r.name}: ${r.wins.toFixed(1)} wins, likely between ${Math.round(
                r.low,
              )} and ${Math.round(r.high)}.`,
          )
          .join(' ')}`}
      >
        <text
          x={PAD.left - 8}
          y={PAD.top - 11}
          fill="var(--text-tertiary)"
          fontSize="11"
          textAnchor="end"
          fontFamily="var(--font-mono-numeric), monospace"
        >
          wins
        </text>

        {ticks.map((wins) => (
          <g key={wins}>
            <line
              x1={x(wins)}
              y1={PAD.top - 6}
              x2={x(wins)}
              y2={height - PAD.bottom}
              stroke="var(--viz-grid)"
              strokeWidth="1"
            />
            <text
              x={x(wins)}
              y={PAD.top - 11}
              fill="var(--text-tertiary)"
              fontSize={AXIS_FONT}
              textAnchor="middle"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {wins}
            </text>
          </g>
        ))}

        {/* .500 is the line every fan reads a record against. */}
        {41 > lo && 41 < hi ? (
          <line
            x1={x(41)}
            y1={PAD.top - 6}
            x2={x(41)}
            y2={height - PAD.bottom}
            stroke="var(--viz-reference)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        ) : null}

        {ordered.map((row, index) => (
          <g key={row.abbreviation}>
            <text
              x={PAD.left - 8}
              y={y(index) + 4}
              fill="var(--text-secondary)"
              fontSize={AXIS_FONT}
              textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {row.abbreviation}
            </text>

            {/* The band first, so the mean marker sits on top of it. */}
            <line
              x1={x(row.low)}
              y1={y(index)}
              x2={x(row.high)}
              y2={y(index)}
              stroke="var(--viz-reference)"
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.55"
            />
            <circle
              cx={x(row.wins)}
              cy={y(index)}
              r="4"
              fill="var(--viz-model)"
              stroke="var(--viz-surface)"
              strokeWidth="1.5"
            >
              <title>
                {`${row.name} · ${row.wins.toFixed(1)}–${(82 - row.wins).toFixed(
                  1,
                )} · 10th-90th ${Math.round(row.low)}–${Math.round(
                  row.high,
                )} · playoffs ${pct(row.p_playoffs, 0)}`}
              </title>
            </circle>

            <text
              x={W - PAD.right + 8}
              y={y(index) + 4}
              fill="var(--text-primary)"
              fontSize={AXIS_FONT}
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {row.wins.toFixed(1)}
            </text>
          </g>
        ))}

        {active && active.target.y != null ? (
          <HighlightRing x={active.target.x} y={active.target.y} r={7} />
        ) : null}
      </svg>
      <ChartTooltip active={active} />
      </div>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        The dot is the mean projected win total; the bar is the 10th to 90th
        percentile across the simulated seasons. The dashed line is .500.
        Read the overlap, not the order — where two bars cover the same
        ground, the model is not claiming to know which team finishes ahead.
      </figcaption>
    </figure>
  )
}

function axisTicks(lo: number, hi: number): number[] {
  const step = hi - lo > 40 ? 10 : 5
  const first = Math.ceil(lo / step) * step
  const out: number[] = []
  for (let v = first; v <= hi; v += step) out.push(v)
  return out
}
