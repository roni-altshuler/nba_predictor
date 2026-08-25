'use client'

import type { PitBucket } from '@/lib/artifacts'
import { pct } from '@/lib/format'

import { ChartEmptyState, ChartTooltip, useChartHover } from './hover'

/**
 * The probability integral transform, against its uniform expectation.
 *
 * **This is the calibration chart for a distribution rather than for a
 * probability.** The reliability diagram tests whether "70%" means 70%; this
 * tests whether the whole published normal — the one every win probability,
 * every score grid and every series price is read off — has the right shape
 * and the right width.
 *
 * Read it as: each bar is the share of games whose result landed in that
 * decile of the model's own predicted distribution. Flat is right. A bar
 * heavy at both ends means the intervals are too narrow and every
 * probability derived from them is overconfident; heavy in the middle means
 * too wide. A tilt means bias.
 *
 * One series, so no legend, and the uniform expectation is a recessive
 * reference line rather than a second colour. Bars wear `--viz-model`, which
 * is already validated against this surface.
 */

const W = 460
const H = 190
const PAD = { top: 14, right: 14, bottom: 30, left: 40 }
/* 2px of surface between adjacent fills, per the mark spec. */
const GAP = 2

interface PitHistogramProps {
  buckets: PitBucket[]
  label: string
}

export function PitHistogram({ buckets, label }: PitHistogramProps) {
  if (!buckets?.length) {
    return <ChartEmptyState>No PIT histogram published.</ChartEmptyState>
  }
  return <PitFigure buckets={buckets} label={label} />
}

/** The drawn chart — split out so the hover hook sits below the early return. */
function PitFigure({ buckets, label }: PitHistogramProps) {
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const expected = buckets[0].expected
  // Scale to the taller of the biggest bar and twice the expectation, so a
  // near-perfect histogram does not get magnified into looking dramatic.
  const max = Math.max(...buckets.map((b) => b.share), expected * 2)
  const barW = plotW / buckets.length

  // Hover: per-bar, with the bar's whole claim in text — the bin, the
  // observed share, and the uniform reference the bar is judged against.
  const { containerRef, active, svgProps } = useChartHover(W, (vx) => {
    if (vx < PAD.left || vx > PAD.left + plotW) return null
    const i = Math.min(
      buckets.length - 1,
      Math.max(0, Math.floor((vx - PAD.left) / barW)),
    )
    const b = buckets[i]
    return {
      x: PAD.left + (i + 0.5) * barW,
      title: `decile ${b.lower.toFixed(1)}–${b.upper.toFixed(1)}`,
      lines: [
        { label: 'observed', value: pct(b.share, 1) },
        { label: 'uniform', value: pct(b.expected, 1), muted: true },
        { label: 'games', value: b.count.toLocaleString(), muted: true },
      ],
    }
  })
  const hoverIndex = active
    ? Math.min(
        buckets.length - 1,
        Math.max(0, Math.floor((active.target.x - PAD.left) / barW)),
      )
    : -1

  return (
    <figure className="m-0">
      <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Probability integral transform for ${label}. Flat bars mean the published distribution is the right shape.`}
        {...svgProps}
      >
        {buckets.map((bucket, i) => {
          const height = (bucket.share / max) * plotH
          return (
            <rect
              key={bucket.lower}
              x={PAD.left + i * barW + GAP / 2}
              y={PAD.top + plotH - height}
              width={Math.max(barW - GAP, 1)}
              height={Math.max(height, 0)}
              rx="2"
              fill="var(--viz-model)"
            >
              {/* The no-JS fallback the styled tooltip sits on top of. */}
              <title>
                {`${bucket.lower.toFixed(1)}–${bucket.upper.toFixed(1)}: ${pct(
                  bucket.share,
                  1,
                )} observed against ${pct(bucket.expected, 1)} uniform (${
                  bucket.count.toLocaleString()
                } games)`}
              </title>
            </rect>
          )
        })}

        {/* Uniform. The whole test is whether the bars sit on this line. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH - (expected / max) * plotH}
          y2={PAD.top + plotH - (expected / max) * plotH}
          stroke="var(--text-tertiary)"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        <text
          x={W - PAD.right}
          y={PAD.top + plotH - (expected / max) * plotH - 5}
          textAnchor="end"
          className="fill-[var(--text-tertiary)] font-numeric text-[11px]"
        >
          uniform
        </text>

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--border-color)"
          strokeWidth="1"
        />
        {['0', 'model median', '1'].map((text, i) => (
          <text
            key={text}
            x={PAD.left + (i / 2) * plotW}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            className="fill-[var(--text-tertiary)] font-numeric text-[11px]"
          >
            {text}
          </text>
        ))}

        {active && hoverIndex >= 0 ? (
          /* A hairline outline on the hovered bar — emphasis, not meaning. */
          <rect
            data-highlight
            x={PAD.left + hoverIndex * barW + GAP / 2}
            y={
              PAD.top +
              plotH -
              (buckets[hoverIndex].share / max) * plotH
            }
            width={Math.max(barW - GAP, 1)}
            height={Math.max((buckets[hoverIndex].share / max) * plotH, 0)}
            rx="2"
            fill="none"
            stroke="var(--text-primary)"
            strokeWidth="1"
          />
        ) : null}
      </svg>
      <ChartTooltip active={active} />
      </div>
      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Where the real {label} fell inside the model&rsquo;s own published
        distribution, in deciles. Flat is correct. Heavy at both ends would
        mean the intervals are too narrow — and because the win probability
        is read off this same distribution, that would make every percentage
        on this site overconfident.
      </figcaption>
    </figure>
  )
}
