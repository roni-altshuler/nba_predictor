'use client'

import { num } from '@/lib/format'

import {
  ChartEmptyState,
  ChartTooltip,
  Crosshair,
  HighlightDot,
  nearestIndex,
  useChartHover,
} from './hover'

/**
 * Model against the closing line, season by season.
 *
 * Two categorical series, so a legend is present AND both lines are
 * direct-labelled at their right end. The direct labels are not decoration:
 * the validated green/blue pair separates well for protan and deutan
 * readers but sits at ΔE 5.7 for tritan, which is only legal with secondary
 * encoding. The labels are that encoding.
 *
 * One axis, always. Brier is the only measure plotted; a second scale for
 * accuracy would be the single most common charting mistake there is.
 *
 * **Lower is better on this axis**, which is the opposite of a reader's
 * default assumption, so the axis is inverted — the better forecaster sits
 * higher — and the caption says so.
 */

export interface SeasonRow {
  season: number
  model?: number | null
  market?: number | null
}

/* Sized for the phone rendering: the 620-unit viewBox scales to ~343px at
   375px width (a 0.55 factor), so axis text is 12 and the direct labels 13. */
const W = 620
const H = 300
const PAD = { top: 18, right: 66, bottom: 40, left: 52 }
const AXIS_FONT = 12
const LABEL_FONT = 13

export function SeasonBrierChart({ rows }: { rows: SeasonRow[] }) {
  const withModel = rows.filter((r) => r.model != null)
  if (withModel.length < 2) {
    return (
      <ChartEmptyState>Not enough scored seasons to draw a trend.</ChartEmptyState>
    )
  }
  return <BrierFigure rows={rows} />
}

/** The drawn chart — split out so the hover hook sits below the early return. */
function BrierFigure({ rows }: { rows: SeasonRow[] }) {
  const values = rows.flatMap((r) =>
    [r.model, r.market].filter((v): v is number => v != null),
  )
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.15 || 0.01
  const yMin = lo - pad
  const yMax = hi + pad

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const seasons = rows.map((r) => r.season)
  const sMin = Math.min(...seasons)
  const sMax = Math.max(...seasons)

  const x = (s: number) =>
    PAD.left + ((s - sMin) / Math.max(1, sMax - sMin)) * plotW
  // Inverted: lower Brier is better, so better sits higher.
  const y = (v: number) =>
    PAD.top + ((v - yMin) / (yMax - yMin)) * plotH

  const path = (key: 'model' | 'market') => {
    const pts = rows
      .filter((r) => r[key] != null)
      .map((r) => `${x(r.season)},${y(r[key] as number)}`)
    return pts.length ? `M${pts.join('L')}` : ''
  }

  const lastOf = (key: 'model' | 'market') => {
    const present = rows.filter((r) => r[key] != null)
    return present.length ? present[present.length - 1] : null
  }
  const lastModel = lastOf('model')
  const lastMarket = lastOf('market')

  const yTicks = 4
  const tickValues = Array.from(
    { length: yTicks + 1 },
    (_, i) => yMin + ((yMax - yMin) * i) / yTicks,
  )

  // Hover: the crosshair snaps to the nearest season and the tooltip lists
  // both series there — an absent market year reads as an em-dash, not a zero.
  const rowXs = rows.map((r) => x(r.season))
  const { containerRef, active, svgProps } = useChartHover(W, (vx) => {
    if (vx < PAD.left - 12 || vx > PAD.left + plotW + 12) return null
    const i = nearestIndex(rowXs, vx)
    const row = rows[i]
    return {
      x: rowXs[i],
      title: `${row.season - 1}–${String(row.season).slice(2)} season`,
      lines: [
        {
          label: 'model',
          swatch: 'var(--viz-model)',
          value: row.model == null ? '—' : num(row.model, 4),
          muted: row.model == null,
        },
        {
          label: 'market',
          swatch: 'var(--viz-market)',
          value: row.market == null ? '—' : num(row.market, 4),
          muted: row.market == null,
        },
      ],
    }
  })
  const hoverRow = active
    ? rows[nearestIndex(rowXs, active.target.x)]
    : null

  return (
    <figure className="m-0">
      {/* Legend is always present for two or more series. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px]">
        <LegendSwatch color="var(--viz-model)" label="This model" />
        <LegendSwatch color="var(--viz-market)" label="Closing line" />
        <span className="ml-auto text-[var(--text-tertiary)]">
          lower is better — better sits higher
        </span>
      </div>

      <div ref={containerRef} className="relative max-w-[760px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        {...svgProps}
        aria-label={
          'Brier score by season. ' +
          rows
            .filter((r) => r.model != null)
            .map(
              (r) =>
                `${r.season}: model ${num(r.model, 4)}${
                  r.market != null ? `, market ${num(r.market, 4)}` : ''
                }.`,
            )
            .join(' ')
        }
      >
        {tickValues.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={y(t)} x2={PAD.left + plotW} y2={y(t)}
              stroke="var(--viz-grid)" strokeWidth="1"
            />
            <text
              x={PAD.left - 8} y={y(t) + 4}
              fill="var(--text-tertiary)" fontSize={AXIS_FONT} textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {t.toFixed(3)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left} y1={PAD.top + plotH} x2={PAD.left + plotW} y2={PAD.top + plotH}
          stroke="var(--viz-axis)" strokeWidth="1"
        />

        {rows
          .filter((_, i) => i % Math.ceil(rows.length / 8) === 0)
          .map((r) => (
            <text
              key={r.season}
              x={x(r.season)} y={PAD.top + plotH + 18}
              fill="var(--text-tertiary)" fontSize={AXIS_FONT} textAnchor="middle"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {String(r.season).slice(2)}
            </text>
          ))}

        <path d={path('market')} fill="none" stroke="var(--viz-market)" strokeWidth="2" />
        <path d={path('model')} fill="none" stroke="var(--viz-model)" strokeWidth="2" />

        {rows
          .filter((r) => r.market != null)
          .map((r) => (
            <circle key={`mk-${r.season}`} cx={x(r.season)} cy={y(r.market as number)}
                    r="3.5" fill="var(--viz-market)"
                    stroke="var(--viz-surface)" strokeWidth="1.5">
              <title>{`${r.season} closing line ${num(r.market, 4)}`}</title>
            </circle>
          ))}
        {rows
          .filter((r) => r.model != null)
          .map((r) => (
            <circle key={`md-${r.season}`} cx={x(r.season)} cy={y(r.model as number)}
                    r="3.5" fill="var(--viz-model)"
                    stroke="var(--viz-surface)" strokeWidth="1.5">
              <title>{`${r.season} model ${num(r.model, 4)}`}</title>
            </circle>
          ))}

        {/* Direct labels — the secondary encoding the tritan gap requires. */}
        {lastModel?.model != null && (
          <text
            x={x(lastModel.season) + 8} y={y(lastModel.model) + 4}
            fill="var(--text-secondary)" fontSize={LABEL_FONT}
            fontFamily="var(--font-mono-numeric), monospace"
          >
            model
          </text>
        )}
        {lastMarket?.market != null && (
          <text
            x={x(lastMarket.season) + 8} y={y(lastMarket.market) + 4}
            fill="var(--text-secondary)" fontSize={LABEL_FONT}
            fontFamily="var(--font-mono-numeric), monospace"
          >
            market
          </text>
        )}

        {active && hoverRow ? (
          <g aria-hidden="true">
            <Crosshair
              x={active.target.x}
              top={PAD.top}
              bottom={PAD.top + plotH}
            />
            {hoverRow.market != null ? (
              <HighlightDot
                x={active.target.x}
                y={y(hoverRow.market)}
                color="var(--viz-market)"
              />
            ) : null}
            {hoverRow.model != null ? (
              <HighlightDot
                x={active.target.x}
                y={y(hoverRow.model)}
                color="var(--viz-model)"
              />
            ) : null}
          </g>
        ) : null}
      </svg>
      <ChartTooltip active={active} />
      </div>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Seasons with no market line have no blue point — those years carried
        no published price in the source, and an absent benchmark is shown as
        absent rather than interpolated.
      </figcaption>
    </figure>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[var(--text-secondary)]">
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-4"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}
