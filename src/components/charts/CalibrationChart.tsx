'use client'

import { pct } from '@/lib/format'

import {
  ChartEmptyState,
  ChartTooltip,
  HighlightRing,
  useChartHover,
} from './hover'

/**
 * A reliability diagram: what the model said against what happened.
 *
 * **This is the most important chart in the product.** Accuracy is a fact
 * about the schedule as much as the model; calibration is a fact about the
 * model alone. A forecaster that says 70% and is right 70% of the time is
 * useful even at modest accuracy, and one that says 70% and is right 55% of
 * the time is dangerous at any accuracy.
 *
 * Form: dots against the ideal diagonal — the "line vs baseline" job, so
 * the diagonal is a de-emphasised reference and the data is the only thing
 * carrying an accent. Dot AREA encodes sample size, because a bucket
 * holding two games and one holding two thousand are not the same evidence
 * and drawing them identically is the chart lying.
 *
 * Rendered as inline SVG rather than through a chart library: it is forty
 * lines of arithmetic, it inherits the design tokens directly, and it adds
 * no client JavaScript to a page that is otherwise fully static.
 */

export interface Bucket {
  lower: number
  upper: number
  count: number
  mean_predicted: number
  observed: number
}

/* Sized for the phone rendering: the 460-unit viewBox scales to ~343px at
   375px width (a 0.75 factor), so axis text is 12 — under that the ticks
   were landing near 7px effective. */
const W = 460
const H = 300
const PAD = { top: 16, right: 16, bottom: 40, left: 46 }
const AXIS_FONT = 12

interface CalibrationProps {
  buckets: Bucket[]
  caption?: string
}

export function CalibrationChart({ buckets, caption }: CalibrationProps) {
  if (!buckets?.length) {
    return <ChartEmptyState>No calibration data published.</ChartEmptyState>
  }
  return <CalibrationFigure buckets={buckets} caption={caption} />
}

/** The drawn chart — split out so the hover hook sits below the early return. */
function CalibrationFigure({ buckets, caption }: CalibrationProps) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (v: number) => PAD.left + v * plotW
  const y = (v: number) => PAD.top + (1 - v) * plotH

  const maxCount = Math.max(...buckets.map((b) => b.count), 1)
  // Area-proportional, floored at 3px so a tiny bucket is still visible and
  // capped at 10 so one enormous bucket does not swallow the plot. The cap
  // matters more than it looks: the middle probability buckets hold
  // thousands of games and an uncapped radius drew discs that covered the
  // reference line they exist to be compared against.
  const radius = (count: number) =>
    Math.max(3, Math.min(10, 3 + 7 * Math.sqrt(count / maxCount)))

  const ticks = [0, 0.25, 0.5, 0.75, 1]

  // Hover: nearest dot by distance, with a generous reach so a fingertip
  // lands one. The tooltip states the bucket's claim in full: what the model
  // said, what happened, and on how many games.
  const { containerRef, active, svgProps } = useChartHover(W, (vx, vy) => {
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < buckets.length; i += 1) {
      const dx = x(buckets[i].mean_predicted) - vx
      const dy = y(buckets[i].observed) - vy
      const dist = Math.hypot(dx, dy)
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
    }
    if (best < 0 || bestDist > 60) return null
    const b = buckets[best]
    return {
      x: x(b.mean_predicted),
      y: y(b.observed),
      title: `bucket ${pct(b.lower, 0)}–${pct(b.upper, 0)}`,
      lines: [
        { label: 'said', value: pct(b.mean_predicted, 1) },
        { label: 'happened', value: pct(b.observed, 1) },
        { label: 'games', value: b.count.toLocaleString(), muted: true },
      ],
    }
  })
  const hoverBucket = active
    ? buckets.find(
        (b) =>
          x(b.mean_predicted) === active.target.x &&
          y(b.observed) === active.target.y,
      )
    : null

  return (
    <figure className="m-0">
      {/* Capped so the SVG renders near its natural size. Left to fill a
          1050px container the 460-wide viewBox scales 2.3x and every dot,
          label and stroke scales with it — the chart stops looking designed
          and starts looking zoomed. */}
      <div ref={containerRef} className="relative max-w-[560px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        {...svgProps}
        aria-label={
          'Reliability diagram. ' +
          buckets
            .map(
              (b) =>
                `Predicted ${pct(b.mean_predicted, 0)}, observed ${pct(
                  b.observed,
                  0,
                )}, ${b.count} games.`,
            )
            .join(' ')
        }
      >
        {/* Recessive grid — present enough to read a value off, quiet enough
            not to compete with the marks. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={x(t)} y1={PAD.top} x2={x(t)} y2={PAD.top + plotH}
              stroke="var(--viz-grid)" strokeWidth="1"
            />
            <line
              x1={PAD.left} y1={y(t)} x2={PAD.left + plotW} y2={y(t)}
              stroke="var(--viz-grid)" strokeWidth="1"
            />
          </g>
        ))}

        {/* The ideal. Dashed and de-emphasised: it is the reference, not a
            series, and drawing it in an accent would make it compete. */}
        <line
          x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)}
          stroke="var(--viz-reference)" strokeWidth="2" strokeDasharray="4 4"
        />
        {/* Sits low on the diagonal, where the buckets are smallest — at the
            top-right it collided with the largest dots. */}
        <text
          x={x(0.13)} y={y(0.2)}
          fill="var(--text-tertiary)"
          fontSize="11"
          fontFamily="var(--font-mono-numeric), monospace"
          transform={`rotate(-45 ${x(0.13)} ${y(0.2)})`}
        >
          perfect calibration
        </text>

        {/* Axes */}
        <line
          x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH}
          stroke="var(--viz-axis)" strokeWidth="1"
        />
        <line
          x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH}
          stroke="var(--viz-axis)" strokeWidth="1"
        />
        {ticks.map((t) => (
          <g key={`lbl-${t}`}>
            <text
              x={x(t)} y={PAD.top + plotH + 18}
              fill="var(--text-tertiary)" fontSize={AXIS_FONT} textAnchor="middle"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {Math.round(t * 100)}%
            </text>
            <text
              x={PAD.left - 8} y={y(t) + 4}
              fill="var(--text-tertiary)" fontSize={AXIS_FONT} textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* Connect the buckets so the shape of the miscalibration is legible
            — a consistent bow reads differently from scatter. */}
        <polyline
          points={buckets
            .map((b) => `${x(b.mean_predicted)},${y(b.observed)}`)
            .join(' ')}
          fill="none"
          stroke="var(--viz-model)"
          strokeWidth="2"
          strokeOpacity="0.45"
        />

        {buckets.map((b, i) => (
          <circle
            key={i}
            cx={x(b.mean_predicted)}
            cy={y(b.observed)}
            r={radius(b.count)}
            fill="var(--viz-model)"
            fillOpacity="0.75"
            // A 2px surface ring so overlapping dots stay countable.
            stroke="var(--viz-surface)"
            strokeWidth="2"
          >
            <title>
              {`Said ${pct(b.mean_predicted, 1)}, happened ${pct(
                b.observed,
                1,
              )} — ${b.count.toLocaleString()} games`}
            </title>
          </circle>
        ))}

        <text
          x={PAD.left + plotW / 2} y={H - 4}
          fill="var(--text-tertiary)" fontSize={AXIS_FONT} textAnchor="middle"
          fontFamily="var(--font-mono-numeric), monospace"
        >
          what the model said
        </text>
        <text
          x={12} y={PAD.top + plotH / 2}
          fill="var(--text-tertiary)" fontSize={AXIS_FONT} textAnchor="middle"
          fontFamily="var(--font-mono-numeric), monospace"
          transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
        >
          what happened
        </text>

        {active && hoverBucket ? (
          <HighlightRing
            x={active.target.x}
            y={active.target.y as number}
            r={radius(hoverBucket.count) + 3}
          />
        ) : null}
      </svg>
      <ChartTooltip active={active} />
      </div>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {caption ??
          'Dot area is the number of games in the bucket. A dot above the dashed line means the model was too cautious; below it, too confident.'}
      </figcaption>

      {/* The table view. Required, not a nicety: it is what makes the chart
          readable without colour, without vision, and in print. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
          View as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Said</th>
                <th scope="col" className="numeric text-right">Happened</th>
                <th scope="col" className="numeric text-right">Games</th>
                <th scope="col" className="numeric text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                <tr key={i}>
                  <td className="numeric">{pct(b.mean_predicted, 1)}</td>
                  <td className="numeric text-right">{pct(b.observed, 1)}</td>
                  <td className="numeric text-right">{b.count.toLocaleString()}</td>
                  <td className="numeric text-right">
                    {pct(b.observed - b.mean_predicted, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
