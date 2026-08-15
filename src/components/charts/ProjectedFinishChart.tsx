import { pct } from '@/lib/format'

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

const ROW_H = 18
const PAD = { top: 22, right: 52, bottom: 8, left: 46 }
const W = 640

export interface FinishRow {
  abbreviation: string
  name: string
  wins: number
  low: number
  high: number
  /** Playoff probability — drives the row's emphasis, with the value shown. */
  p_playoffs: number
}

export function ProjectedFinishChart({
  rows,
  label,
}: {
  rows: FinishRow[]
  label: string
}) {
  if (rows.length < 2) return null

  const ordered = [...rows].sort((a, b) => b.wins - a.wins)
  const lo = Math.max(0, Math.floor(Math.min(...ordered.map((r) => r.low)) - 2))
  const hi = Math.min(82, Math.ceil(Math.max(...ordered.map((r) => r.high)) + 2))
  const span = Math.max(1, hi - lo)

  const plotW = W - PAD.left - PAD.right
  const height = PAD.top + ordered.length * ROW_H + PAD.bottom
  const x = (wins: number) => PAD.left + ((wins - lo) / span) * plotW
  const y = (index: number) => PAD.top + index * ROW_H + ROW_H / 2

  const ticks = axisTicks(lo, hi)

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full max-w-[720px]"
        role="img"
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
          fontSize="9"
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
              fontSize="9"
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
              y={y(index) + 3}
              fill="var(--text-secondary)"
              fontSize="10"
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
              y={y(index) + 3}
              fill="var(--text-primary)"
              fontSize="10"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {row.wins.toFixed(1)}
            </text>
          </g>
        ))}
      </svg>

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
