/**
 * One franchise's Elo across seasons, against the league.
 *
 * **Emphasis, not categorical.** Thirty series on one chart is thirty
 * indistinguishable lines; the dataviz rule is that past a handful of
 * series you fold the tail rather than generate hues. Here the tail folds
 * into a de-emphasised band — the league's 10th-to-90th percentile — and
 * the one franchise the reader asked about carries the only accent. That is
 * the honest form for "how good was this team, compared to everyone".
 *
 * The 1500 line is the league mean by construction (Elo is zero-sum), so it
 * is drawn as a reference rather than computed.
 */

const W = 620
const H = 240
const PAD = { top: 16, right: 44, bottom: 32, left: 44 }

export function RatingHistoryChart({
  seasons,
  values,
  band,
  label,
}: {
  seasons: number[]
  /** The focused team's end-of-season Elo, null where it did not play. */
  values: Array<number | null>
  /** League 10th and 90th percentile per season. */
  band: Array<{ low: number; high: number } | null>
  label: string
}) {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((d): d is { v: number; i: number } => d.v != null)
  if (present.length < 2) {
    return (
      <p className="text-xs text-[var(--text-tertiary)]">
        Not enough seasons to draw a trend for {label}.
      </p>
    )
  }

  const all = [
    ...present.map((d) => d.v),
    ...band.filter(Boolean).flatMap((b) => [b!.low, b!.high]),
    1500,
  ]
  const lo = Math.min(...all) - 30
  const hi = Math.max(...all) + 30

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) =>
    PAD.left + (i / Math.max(1, seasons.length - 1)) * plotW
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH

  const bandPath = (() => {
    const highs = band
      .map((b, i) => (b ? `${x(i)},${y(b.high)}` : null))
      .filter(Boolean) as string[]
    const lows = band
      .map((b, i) => (b ? `${x(i)},${y(b.low)}` : null))
      .filter(Boolean)
      .reverse() as string[]
    if (!highs.length) return ''
    return `M${highs.join('L')}L${lows.join('L')}Z`
  })()

  const linePath = `M${present.map((d) => `${x(d.i)},${y(d.v)}`).join('L')}`
  const last = present[present.length - 1]

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px]">
        <span className="inline-flex items-center gap-2 text-[var(--text-secondary)]">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4"
            style={{ background: 'var(--viz-model)' }}
          />
          {label}
        </span>
        <span className="inline-flex items-center gap-2 text-[var(--text-tertiary)]">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-4 rounded-[1px]"
            style={{ background: 'var(--viz-reference)', opacity: 0.35 }}
          />
          league 10th–90th percentile
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[760px]"
        role="img"
        aria-label={`${label} end-of-season Elo rating. ${present
          .map((d) => `${seasons[d.i]}: ${Math.round(d.v)}.`)
          .join(' ')}`}
      >
        {bandPath ? (
          <path d={bandPath} fill="var(--viz-reference)" fillOpacity="0.28" />
        ) : null}

        <line
          x1={PAD.left} y1={y(1500)} x2={PAD.left + plotW} y2={y(1500)}
          stroke="var(--viz-axis)" strokeWidth="1" strokeDasharray="3 3"
        />
        <text
          x={PAD.left + plotW + 6} y={y(1500) + 3}
          fill="var(--text-tertiary)" fontSize="9"
          fontFamily="var(--font-mono-numeric), monospace"
        >
          1500
        </text>

        <path d={linePath} fill="none" stroke="var(--viz-model)" strokeWidth="2" />

        {present.map((d) => (
          <circle
            key={d.i}
            cx={x(d.i)} cy={y(d.v)} r="3"
            fill="var(--viz-model)"
            stroke="var(--viz-surface)" strokeWidth="1.5"
          >
            <title>{`${seasons[d.i]}: ${Math.round(d.v)}`}</title>
          </circle>
        ))}

        {/* Direct label at the last point — identity is never colour-alone. */}
        <text
          x={x(last.i) + 7} y={y(last.v) + 3}
          fill="var(--text-primary)" fontSize="10"
          fontFamily="var(--font-mono-numeric), monospace"
        >
          {Math.round(last.v)}
        </text>

        {seasons.map((season, i) =>
          i % Math.ceil(seasons.length / 8) === 0 ? (
            <text
              key={season}
              x={x(i)} y={PAD.top + plotH + 16}
              fill="var(--text-tertiary)" fontSize="10" textAnchor="middle"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {String(season).slice(2)}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        End-of-season rating. 1500 is the league mean by construction — Elo is
        zero-sum, so the average team is always 1500 and a rising line means
        rising relative to everyone else, not in absolute terms. Gaps are
        seasons the franchise did not play under this name.
      </figcaption>
    </figure>
  )
}
