import type { WinProbability } from '@/lib/espn'
import { pct } from '@/lib/format'

/**
 * The in-game win probability curve, from ESPN.
 *
 * **Not this project's number, and the caption says so in words.** ESPN's
 * live model reads time, score and possession; this project's forecaster
 * reads none of them and stops at tip-off. Two curves on one axis would
 * imply a comparison no benchmark on this site supports, so there is one
 * series here and the pre-game figure appears as a labelled starting point
 * rather than as a second line.
 *
 * One series, so no legend — the title names it, which is the rule. It wears
 * `--viz-model`, already validated against this surface; nothing new was
 * introduced and no palette needed re-checking.
 *
 * The 50% line is the reference and is drawn recessive. The shape readers
 * want is where the curve crosses it and how long it stayed on the wrong
 * side, which is exactly what the running-score row beneath this chart can
 * only say in numbers.
 */

const W = 720
const H = 220
const PAD = { top: 14, right: 14, bottom: 26, left: 40 }

export function WinProbabilityChart({
  probability,
  homeLabel,
  awayLabel,
}: {
  probability: WinProbability
  homeLabel: string
  awayLabel: string
}) {
  const points = probability.points
  if (points.length < 2) return null

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  // Indexed by position, not by ESPN's play id: play ids are monotone but
  // not evenly spaced, and spacing the x-axis by them stretches whichever
  // quarter happened to have the most reviewed calls.
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW
  const y = (p: number) => PAD.top + (1 - p) * plotH

  const path = points
    .map((point, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(point.homeWinPercentage).toFixed(1)}`)
    .join(' ')

  // Period boundaries, drawn as hairlines. They are the only x-axis a
  // basketball game really has — "midway through the third" is how anyone
  // describes a moment in one, and an index is how nobody does.
  const boundaries: Array<{ index: number; period: number }> = []
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1].period
    const current = points[i].period
    if (current != null && previous != null && current !== previous) {
      boundaries.push({ index: i, period: current })
    }
  }

  const final = points[points.length - 1].homeWinPercentage
  const homeWon = final >= 0.5

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`In-game win probability for ${homeLabel} against ${awayLabel}. ${
          homeWon ? homeLabel : awayLabel
        } won.`}
      >
        {/* Even money. The reference, so it is recessive and dashed. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(0.5)}
          y2={y(0.5)}
          stroke="var(--border-color)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {[0, 0.5, 1].map((value) => (
          <text
            key={value}
            x={PAD.left - 8}
            y={y(value) + 3}
            textAnchor="end"
            className="fill-[var(--text-tertiary)] font-numeric text-[9px]"
          >
            {value === 0.5 ? '50%' : value === 1 ? `${homeLabel}` : `${awayLabel}`}
          </text>
        ))}

        {boundaries.map(({ index, period }) => (
          <g key={`${index}-${period}`}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--border-color)"
              strokeWidth="1"
            />
            <text
              x={x(index) + 4}
              y={H - PAD.bottom + 12}
              className="fill-[var(--text-tertiary)] font-numeric text-[9px]"
            >
              {period > 4 ? `OT${period - 4}` : `Q${period}`}
            </text>
          </g>
        ))}

        <path
          d={path}
          fill="none"
          stroke="var(--viz-model)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Win probability for {homeLabel} through the game,{' '}
        <strong className="text-[var(--text-secondary)]">from ESPN</strong> — a
        different model from the one that made the forecast above. It reads
        the score and the clock; ours reads neither and stops at tip-off.
        {probability.comebackFrom !== null ? (
          <>
            {' '}
            {homeWon ? homeLabel : awayLabel} fell to{' '}
            <span className="font-numeric text-[var(--text-secondary)]">
              {pct(probability.comebackFrom, 1)}
            </span>{' '}
            and won.
          </>
        ) : null}
        {probability.biggestSwing && probability.biggestSwing.delta >= 0.1 ? (
          <>
            {' '}
            Biggest single swing:{' '}
            <span className="font-numeric text-[var(--text-secondary)]">
              {pct(probability.biggestSwing.delta, 1)}
            </span>{' '}
            toward{' '}
            {probability.biggestSwing.toward === 'home' ? homeLabel : awayLabel}
            {probability.biggestSwing.period
              ? ` in ${
                  probability.biggestSwing.period > 4
                    ? `OT${probability.biggestSwing.period - 4}`
                    : `Q${probability.biggestSwing.period}`
                }`
              : ''}
            {probability.biggestSwing.clock ? ` (${probability.biggestSwing.clock})` : ''}.
          </>
        ) : null}
      </figcaption>
    </figure>
  )
}
