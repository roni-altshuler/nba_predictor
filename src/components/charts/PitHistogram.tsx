import type { PitBucket } from '@/lib/artifacts'

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

export function PitHistogram({
  buckets,
  label,
}: {
  buckets: PitBucket[]
  label: string
}) {
  if (!buckets?.length) {
    return (
      <p className="text-xs text-[var(--text-tertiary)]">
        No PIT histogram published.
      </p>
    )
  }

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const expected = buckets[0].expected
  // Scale to the taller of the biggest bar and twice the expectation, so a
  // near-perfect histogram does not get magnified into looking dramatic.
  const max = Math.max(...buckets.map((b) => b.share), expected * 2)
  const barW = plotW / buckets.length

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Probability integral transform for ${label}. Flat bars mean the published distribution is the right shape.`}
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
            />
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
          className="fill-[var(--text-tertiary)] font-numeric text-[9px]"
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
            y={H - 10}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            className="fill-[var(--text-tertiary)] font-numeric text-[9px]"
          >
            {text}
          </text>
        ))}
      </svg>
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
