'use client'

import { pct } from '@/lib/format'
import type { TitleRace, TitleRaceTeam } from '@/lib/history'

import {
  ChartTooltip,
  Crosshair,
  HighlightDot,
  nearestIndex,
  useChartHover,
} from './hover'

/**
 * The conference title race as a line per contender.
 *
 * **Three named lines and a field, never thirty.** Conference-title
 * probabilities sum to one inside a conference, so the three leaders plus an
 * aggregated "field" account for the whole distribution — nothing is dropped
 * from this chart, it is folded, and the caption says so. Three is also the
 * number the palette validator allowed: every four-hue set tried failed CVD
 * separation (green/orange 4.6 deutan, blue/purple 2.1). See the token block
 * in `globals.css`.
 *
 * **Identity is never colour alone.** Each line is labelled with its team
 * abbreviation at its right edge, because the validated trio's tritan
 * separation is 4.6 — below the floor that colour alone may carry.
 *
 * **Time is the x-axis, not the checkpoint index.** The live tracker runs
 * whenever the pipeline runs and the backtest steps every ten days; plotting
 * position by index would silently stretch a gap in the run history into a
 * straight, confident line.
 *
 * **`basis` is printed, always.** A live line was published in advance. A
 * backtest line is a reconstruction that nobody read at the time. Drawing
 * them with the same component makes labelling them the component's job.
 */

/* Font sizes are set for the chart's SMALLEST rendering, not its largest: the
   640-unit viewBox scales to ~343px on a phone, a 0.54 factor, so a 9px axis
   label lands under 5px effective. Axis text is 12 and the end labels — the
   only channel carrying identity for a colour-blind reader — are 13. */
const W = 640
const H = 260
const PAD = { top: 14, right: 88, bottom: 32, left: 46 }
const AXIS_FONT = 12
const LABEL_FONT = 13
/* De-collision gap: end-label font size plus breathing room. */
const LABEL_GAP = 15
const LINE_COLORS = ['var(--viz-cat-1)', 'var(--viz-cat-2)', 'var(--viz-cat-3)']
const NAMED = 3

interface Track {
  key: string
  label: string
  color: string
  values: Array<number | null>
  isField: boolean
}

export function TitleRaceChart({
  race,
  conference,
}: {
  race: TitleRace
  conference: string
}) {
  const checkpoints = race.checkpoints ?? []
  const members = Object.values(race.teams ?? {}).filter(
    (t) => t.conference === conference,
  )

  if (checkpoints.length < 2 || !members.length) {
    return <NotYetALine race={race} conference={conference} count={checkpoints.length} />
  }

  return <RaceFigure race={race} conference={conference} members={members} />
}

/**
 * The drawn chart, split out so the hover hook sits below the empty-state
 * early return — hooks must be unconditional.
 */
function RaceFigure({
  race,
  conference,
  members,
}: {
  race: TitleRace
  conference: string
  members: TitleRaceTeam[]
}) {
  const checkpoints = race.checkpoints
  const latest = checkpoints[checkpoints.length - 1].probabilities ?? {}
  const ranked = [...members].sort(
    (a, b) => (latest[b.abbreviation] ?? 0) - (latest[a.abbreviation] ?? 0),
  )
  const named = ranked.slice(0, NAMED)
  const rest = ranked.slice(NAMED)

  const tracks: Track[] = named.map((team, i) => ({
    key: team.abbreviation,
    label: team.abbreviation,
    color: LINE_COLORS[i],
    isField: false,
    values: checkpoints.map((c) => c.probabilities?.[team.abbreviation] ?? null),
  }))
  if (rest.length) {
    tracks.push({
      key: '__field',
      label: `field (${rest.length})`,
      color: 'var(--viz-cat-field)',
      isField: true,
      values: checkpoints.map((c) =>
        rest.reduce((sum, t) => sum + (c.probabilities?.[t.abbreviation] ?? 0), 0),
      ),
    })
  }

  const times = checkpoints.map((c) => new Date(`${c.date}T00:00:00Z`).getTime())
  const tMin = times[0]
  const tMax = times[times.length - 1]
  const span = Math.max(1, tMax - tMin)

  const peak = Math.max(
    0.35,
    ...tracks.flatMap((t) => t.values.map((v) => v ?? 0)),
  )
  const yMax = Math.min(1, Math.ceil((peak + 0.05) * 10) / 10)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + ((times[i] - tMin) / span) * plotW
  const y = (v: number) => PAD.top + (1 - v / yMax) * plotH

  const ticks = yTicks(yMax)
  // Only THIS conference's champion is a comment on THIS chart. The Western
  // panel noting that a team from the East is missing from its three lines
  // reads as a finding; it is a tautology.
  const champion =
    race.champion && race.teams?.[race.champion]?.conference === conference
      ? race.champion
      : null

  // Direct labels are the ONLY thing carrying identity for a colour-blind
  // reader here — the validated trio's tritan separation is 4.6 — so two of
  // them landing on top of each other is not a cosmetic problem. Nudged
  // apart before drawing; the line still ends where the data says.
  const labelY = deCollide(
    tracks.map((track) => {
      const index = lastPresent(track.values)
      return index < 0 ? null : y(track.values[index] as number)
    }),
    LABEL_GAP,
    PAD.top,
    PAD.top + plotH,
  )

  // The hover layer: crosshair snaps to the nearest checkpoint and the
  // tooltip lists every visible series' value at that date.
  const checkpointXs = checkpoints.map((_, i) => x(i))
  const { containerRef, active, svgProps } = useChartHover(W, (vx) => {
    if (vx < PAD.left - 12 || vx > PAD.left + plotW + 12) return null
    const i = nearestIndex(checkpointXs, vx)
    const c = checkpoints[i]
    return {
      x: checkpointXs[i],
      title: `${c.date} · ${c.games_played.toLocaleString()} games`,
      lines: tracks.map((track) => ({
        label: track.isField ? track.label : track.key,
        swatch: track.color,
        muted: track.isField,
        value:
          track.values[i] == null ? '—' : pct(track.values[i] as number, 1),
      })),
    }
  })
  const hoverIndex = active ? nearestIndex(checkpointXs, active.target.x) : -1

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        {tracks.map((track) => (
          <span
            key={track.key}
            className={
              track.isField
                ? 'inline-flex items-center gap-2 text-[var(--text-tertiary)]'
                : 'inline-flex items-center gap-2 text-[var(--text-secondary)]'
            }
          >
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4"
              style={{ background: track.color }}
            />
            {track.isField ? track.label : nameOf(race, track.key)}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="relative max-w-[720px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        {...svgProps}
        aria-label={`${conference} title probability over the ${race.season - 1}-${String(
          race.season,
        ).slice(2)} season. ${tracks
          .map(
            (t) =>
              `${t.isField ? 'The field' : t.label}: ${pct(
                t.values[0] ?? 0,
                0,
              )} at the start, ${pct(t.values[t.values.length - 1] ?? 0, 0)} at the end.`,
          )
          .join(' ')}`}
      >
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              y1={y(value)}
              x2={PAD.left + plotW}
              y2={y(value)}
              stroke="var(--viz-grid)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(value) + 4}
              fill="var(--text-tertiary)"
              fontSize={AXIS_FONT}
              textAnchor="end"
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {Math.round(value * 100)}%
            </text>
          </g>
        ))}

        {tracks.map((track, trackIndex) => {
          const points = track.values
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean) as string[]
          if (points.length < 2) return null
          const lastIndex = lastPresent(track.values)
          return (
            <g key={track.key}>
              <path
                d={`M${points.join('L')}`}
                fill="none"
                stroke={track.color}
                strokeWidth={track.isField ? 1.5 : 2}
                strokeDasharray={track.isField ? '4 3' : undefined}
                opacity={track.isField ? 0.75 : 1}
              />
              {/* Hit targets larger than the mark, per the interaction spec —
                  an invisible 7px circle on a 2px line. */}
              {track.values.map((v, i) =>
                v == null ? null : (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(v)}
                    r="7"
                    fill="transparent"
                  >
                    <title>
                      {`${track.isField ? 'The field' : nameOf(race, track.key)} · ${
                        checkpoints[i].date
                      } · ${pct(v, 1)} (${checkpoints[
                        i
                      ].games_played.toLocaleString()} games banked)`}
                    </title>
                  </circle>
                ),
              )}
              {lastIndex >= 0 && labelY[trackIndex] != null ? (
                <>
                  {/* A leader from the line's real end to its nudged label,
                      so the nudge never becomes a misreading. */}
                  <line
                    x1={x(lastIndex) + 2}
                    y1={y(track.values[lastIndex] as number)}
                    x2={x(lastIndex) + 6}
                    y2={labelY[trackIndex] as number}
                    stroke={track.color}
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <text
                    x={x(lastIndex) + 8}
                    y={(labelY[trackIndex] as number) + 4}
                    fill={
                      track.isField ? 'var(--text-tertiary)' : 'var(--text-primary)'
                    }
                    fontSize={LABEL_FONT}
                    fontFamily="var(--font-mono-numeric), monospace"
                  >
                    {track.isField ? 'field' : track.label}{' '}
                    {pct(track.values[lastIndex] as number, 0)}
                  </text>
                </>
              ) : null}
            </g>
          )
        })}

        {[0, Math.floor((checkpoints.length - 1) / 2), checkpoints.length - 1].map(
          (i, n) => (
            <text
              key={`${i}-${n}`}
              x={x(i)}
              y={PAD.top + plotH + 18}
              fill="var(--text-tertiary)"
              fontSize={AXIS_FONT}
              textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}
              fontFamily="var(--font-mono-numeric), monospace"
            >
              {shortDate(checkpoints[i].date)}
            </text>
          ),
        )}

        {active && hoverIndex >= 0 ? (
          <g aria-hidden="true">
            <Crosshair
              x={active.target.x}
              top={PAD.top}
              bottom={PAD.top + plotH}
            />
            {tracks.map((track) => {
              const v = track.values[hoverIndex]
              return v == null ? null : (
                <HighlightDot
                  key={track.key}
                  x={active.target.x}
                  y={y(v)}
                  color={track.color}
                />
              )
            })}
          </g>
        ) : null}
      </svg>
      <ChartTooltip active={active} />
      </div>

      <figcaption className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {race.basis === 'backtest' ? (
          <>
            <span className="text-[var(--accent-warn)]">A reconstruction.</span>{' '}
            Each checkpoint re-simulated the rest of the season from ratings
            built on games strictly earlier than that date, so the model never
            saw the future — but nobody read these numbers on those days.
            {champion && named.some((t) => t.abbreviation === champion) ? (
              <> {nameOf(race, champion)} went on to win the title.</>
            ) : champion ? (
              <>
                {' '}
                {nameOf(race, champion)} won the title from outside the three
                leaders here — which is the sort of thing this chart exists to
                show.
              </>
            ) : null}
          </>
        ) : (
          <>
            One point per day the forecast ran. These numbers were published in
            advance.
          </>
        )}{' '}
        Probabilities inside a conference sum to one, so the three named
        contenders and the field account for all {members.length} teams —
        nothing is dropped.
      </figcaption>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-[var(--accent-info)]">
          Table view
        </summary>
        <div className="card mt-2 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="numeric text-right">Games</th>
                {tracks.map((t) => (
                  <th key={t.key} scope="col" className="numeric text-right">
                    {t.isField ? 'Field' : t.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {checkpoints.map((c, i) => (
                <tr key={c.date}>
                  <td className="numeric">{c.date}</td>
                  <td className="numeric text-right text-[var(--text-tertiary)]">
                    {c.games_played.toLocaleString()}
                  </td>
                  {tracks.map((t) => (
                    <td key={t.key} className="numeric text-right">
                      {t.values[i] == null ? '—' : pct(t.values[i] as number, 1)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

/**
 * What a line looks like before there is a line.
 *
 * Shown rather than hidden: an empty chart area and a missing chart look the
 * same to a reader, and only one of them is the truth here.
 */
function NotYetALine({
  race,
  conference,
  count,
}: {
  race: TitleRace
  conference: string
  count: number
}) {
  const members = Object.values(race.teams ?? {}).filter(
    (t) => t.conference === conference,
  )
  const latest = race.checkpoints?.[race.checkpoints.length - 1]
  const leaders = members
    .map((t) => ({ team: t, p: latest?.probabilities?.[t.abbreviation] ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5)

  return (
    <div>
      <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">
        {count === 0
          ? 'No projection has been tracked yet.'
          : `One snapshot so far, taken ${latest?.date}. A line needs two points, and the second arrives the next time the forecast runs — the pipeline appends one per day, so this becomes a race as the season is played.`}
      </p>
      {leaders.length ? (
        <ul className="mt-3 space-y-1">
          {leaders.map(({ team, p }) => (
            <li
              key={team.abbreviation}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="text-[var(--text-secondary)]">{team.name}</span>
              <span className="numeric text-[var(--text-primary)]">{pct(p)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function nameOf(race: TitleRace, abbreviation: string): string {
  return race.teams?.[abbreviation]?.name ?? abbreviation
}

/**
 * Push overlapping end-labels apart, preserving their vertical order.
 *
 * Two lines that finish a percentage point apart put their labels on the
 * same pixel row, and the second one wins — so the reader sees three lines
 * and two labels. Sorted by position, spaced by at least `gap`, then the
 * whole stack is shifted back inside the plot if it overflowed the bottom.
 *
 * Order is preserved rather than recomputed, which is what makes this safe:
 * a label never crosses another, so it still points at the line it names.
 */
function deCollide(
  positions: Array<number | null>,
  gap: number,
  top: number,
  bottom: number,
): Array<number | null> {
  const present = positions
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => item.value != null)
    .sort((a, b) => a.value - b.value)

  let previous = -Infinity
  for (const item of present) {
    const next = Math.max(item.value, previous + gap)
    item.value = next
    previous = next
  }

  // If the stack ran off the bottom, slide it up as a block rather than
  // compressing it — compression puts two labels back on one row.
  const overflow = present.length ? present[present.length - 1].value - bottom : 0
  if (overflow > 0) {
    for (const item of present) item.value -= overflow
  }
  for (const item of present) item.value = Math.max(top, item.value)

  const out: Array<number | null> = positions.map(() => null)
  for (const item of present) out[item.index] = item.value
  return out
}

function lastPresent(values: Array<number | null>): number {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] != null) return i
  }
  return -1
}

function yTicks(max: number): number[] {
  const step = max > 0.6 ? 0.25 : max > 0.35 ? 0.1 : 0.05
  const out: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
