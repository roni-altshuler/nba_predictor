import { TeamLogo } from '@/components/primitives/TeamLogo'
import {
  type BracketNode,
  planBracket,
  roundName,
} from '@/lib/bracketLayout'
import { cn } from '@/lib/utils'

/**
 * The playoff board.
 *
 * **Drawn at full size and panned; never silently shrunk.** An earlier
 * instinct is to fit the viewport with a CSS transform, which renders the
 * thing a reader came for at two-thirds size on a laptop. The board keeps
 * its real dimensions and scrolls horizontally on narrow screens, with the
 * scroll container announcing itself.
 *
 * **A knocked-out club is struck through on the series that eliminated it,
 * and only there.** Propagating the strike back over earlier rounds would
 * cross out the winning side of a series it won. Both the strike and the
 * champion bar are gated on the winner being one of the two teams that
 * actually played — read literally, a `winner` matching neither side would
 * strike both names and crown nobody.
 */

export interface BracketSeries {
  series_id: string
  round_slug: string
  depth: number | null
  team_a?: string | null
  team_b?: string | null
  wins_a: number
  wins_b: number
  winner?: string | null
  completed: boolean
}

export interface TeamMeta {
  abbreviation: string
  name: string
  logo?: string | null
  conference?: string | null
}

const ROUNDS_PER_SIDE = 3

export function PlayoffBracket({
  series,
  teams,
  season,
}: {
  series: BracketSeries[]
  teams: Record<string, TeamMeta>
  season: number
}) {
  const geometry = planBracket(ROUNDS_PER_SIDE)

  // Split by conference from the teams' own membership rather than from the
  // round label — ESPN's round vocabulary changes between seasons and the
  // conference a franchise plays in does not.
  const east = series.filter((s) => sideOf(s, teams) === 'left')
  const west = series.filter((s) => sideOf(s, teams) === 'right')
  const finals = series.find((s) => s.depth === 0)

  const assigned = new Map<string, BracketSeries>()
  for (const [side, members] of [['left', east], ['right', west]] as const) {
    for (let depth = ROUNDS_PER_SIDE; depth >= 1; depth -= 1) {
      const round = members
        .filter((s) => s.depth === depth)
        .sort((a, b) => (a.series_id > b.series_id ? 1 : -1))
      round.forEach((item, index) => {
        assigned.set(`${side}:${depth}:${index}`, item)
      })
    }
  }
  if (finals) assigned.set('centre:0:0', finals)

  const champion = finals?.winner || null

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">Playoff bracket · {season - 1}-{String(season).slice(2)}</h2>
        {champion ? (
          <span className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-warn)]">
            Champion · {teams[champion]?.name ?? champion}
          </span>
        ) : null}
      </div>

      <div
        className="card overflow-x-auto p-4"
        tabIndex={0}
        role="region"
        aria-label={`Playoff bracket for the ${season - 1}-${String(season).slice(2)} season. Scrollable.`}
      >
        <div
          className="relative mx-auto"
          style={{ width: geometry.width, height: geometry.height }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={geometry.width}
            height={geometry.height}
            aria-hidden="true"
          >
            {geometry.connectors.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="var(--border-color)"
                strokeWidth="1"
              />
            ))}
          </svg>

          {geometry.nodes.map((node) => {
            const key = `${node.side}:${node.depth}:${node.slot}`
            return (
              <SeriesCard
                key={key}
                node={node}
                series={assigned.get(key)}
                teams={teams}
              />
            )
          })}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
        Card positions and connectors are computed arithmetic, not nested
        boxes — the card feeding a round sits exactly halfway between the two
        beneath it, and that is asserted by a test rather than left to the
        box model.
      </p>
    </section>
  )
}

function SeriesCard({
  node,
  series,
  teams,
}: {
  node: BracketNode
  series?: BracketSeries
  teams: Record<string, TeamMeta>
}) {
  const style = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
  }

  if (!series) {
    return (
      <div
        className="absolute flex items-center justify-center rounded-sm border border-dashed border-[var(--border-color)] px-2"
        style={style}
      >
        <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
          {roundName(node.depth)}
        </span>
      </div>
    )
  }

  const a = series.team_a
  const b = series.team_b
  const winner = series.winner
  // Gate on the winner being one of the two that played. Read literally, a
  // winner matching neither would strike both names.
  const validWinner = winner && (winner === a || winner === b) ? winner : null

  return (
    <div
      className="absolute flex flex-col justify-center gap-0.5 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1"
      style={style}
    >
      <SeriesRow
        team={a}
        wins={series.wins_a}
        eliminated={Boolean(validWinner) && validWinner !== a}
        won={validWinner === a}
        teams={teams}
      />
      <SeriesRow
        team={b}
        wins={series.wins_b}
        eliminated={Boolean(validWinner) && validWinner !== b}
        won={validWinner === b}
        teams={teams}
      />
    </div>
  )
}

function SeriesRow({
  team,
  wins,
  eliminated,
  won,
  teams,
}: {
  team?: string | null
  wins: number
  eliminated: boolean
  won: boolean
  teams: Record<string, TeamMeta>
}) {
  const meta = team ? teams[team] : undefined
  return (
    <div className="flex items-center gap-1.5">
      <TeamLogo
        logo={meta?.logo}
        abbreviation={team}
        name={meta?.name}
        size={14}
      />
      <span
        className={cn(
          'flex-1 truncate font-numeric text-[11px]',
          won ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
          eliminated && 'text-[var(--text-tertiary)] line-through',
        )}
      >
        {team ?? '—'}
      </span>
      <span
        className={cn(
          'numeric text-[11px]',
          won ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
        )}
      >
        {wins}
      </span>
    </div>
  )
}

function sideOf(
  series: BracketSeries,
  teams: Record<string, TeamMeta>,
): 'left' | 'right' | 'centre' {
  if (series.depth === 0) return 'centre'
  const conference =
    (series.team_a && teams[series.team_a]?.conference) ||
    (series.team_b && teams[series.team_b]?.conference)
  if (!conference) return 'left'
  return conference.toLowerCase().includes('east') ? 'left' : 'right'
}
