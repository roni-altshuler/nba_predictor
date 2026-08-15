import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { ProjectedBracket as BracketArtifact, RoundReach } from '@/lib/artifacts'
import { pct } from '@/lib/format'
import { planBracket, roundName, type BracketNode } from '@/lib/bracketLayout'
import { cn } from '@/lib/utils'

/**
 * The projected postseason board.
 *
 * Shares its geometry with the historical bracket — same `planBracket`, same
 * mirrored shape the league itself publishes — and differs in exactly one
 * way, which is the important one: **every cell past the first round is a
 * MARGINAL probability, not a propagated path.**
 *
 * A first-round card names two real projected seeds and prices the series by
 * exact enumeration. A conference-semi-final card cannot do that, because
 * who is in it depends on results that have not happened. So instead of
 * inventing a matchup, each later cell names the likeliest occupant of that
 * bracket position and prints its probability of REACHING that round, taken
 * from the simulation, which integrates over every seeding it produced.
 *
 * The alternative — advance the modal winner of each series and re-price the
 * next round — draws a much more satisfying bracket and is wrong. It
 * compounds one seeding assumption four rounds deep and then prints the
 * result as a championship probability. The number in the centre cell here
 * is the same number the season projection publishes, because it is
 * literally the same number.
 */

const ROUNDS_PER_SIDE = 3

interface Cell {
  team: RoundReach
  probability: number
}

export function ProjectedBracket({ bracket }: { bracket: BracketArtifact }) {
  const geometry = planBracket(ROUNDS_PER_SIDE)
  const reach = new Map(bracket.rounds.map((t) => [t.team_id, t]))

  const sides = {
    left: 'Eastern Conference',
    right: 'Western Conference',
  } as const

  // Each side's first-round cards, in bracket order (1/8, 4/5, 3/6, 2/7) —
  // the order that puts the 1 and 2 seeds in opposite halves.
  const cards = new Map<string, React.ReactNode>()

  for (const [side, conference] of Object.entries(sides) as Array<
    ['left' | 'right', string]
  >) {
    const block = bracket.conferences[conference]
    if (!block) continue

    block.first_round.forEach((series, slot) => {
      cards.set(
        `${side}:3:${slot}`,
        <SeriesCell
          key={`${side}:3:${slot}`}
          rows={[
            {
              seed: series.high_seed,
              abbreviation: series.high.abbreviation,
              name: series.high.name,
              logo: series.high.logo,
              probability: series.p_high_series,
              lead: series.p_high_series >= 0.5,
            },
            {
              seed: series.low_seed,
              abbreviation: series.low.abbreviation,
              name: series.low.name,
              logo: series.low.logo,
              probability: series.p_low_series,
              lead: series.p_low_series > 0.5,
            },
          ]}
        />,
      )
    })

    // Candidate pools per later slot: a conference-semi slot is fed by two
    // first-round series, so its candidates are those four teams.
    const pools: RoundReach[][] = block.first_round.map((series) =>
      [series.high.team_id, series.low.team_id]
        .map((id) => reach.get(id))
        .filter(Boolean) as RoundReach[],
    )

    const semiPools = mergePairs(pools)
    semiPools.forEach((pool, slot) => {
      const rows = topTwo(pool, (t) => t.p_conf_semis)
      cards.set(
        `${side}:2:${slot}`,
        <ReachCell
          key={`${side}:2:${slot}`}
          rows={rows.map((t) => ({ team: t, probability: t.p_conf_semis }))}
        />,
      )
    })

    const finalPool = semiPools.flat()
    cards.set(
      `${side}:1:0`,
      <ReachCell
        key={`${side}:1:0`}
        rows={topTwo(finalPool, (t) => t.p_conf_finals).map((t) => ({
          team: t,
          probability: t.p_conf_finals,
        }))}
      />,
    )
  }

  // The Finals: the likeliest conference champion from each side.
  const finalists = (['Eastern Conference', 'Western Conference'] as const)
    .map(
      (conference) =>
        bracket.rounds
          .filter((t) => t.conference === conference)
          .sort((a, b) => b.p_finals - a.p_finals)[0],
    )
    .filter(Boolean) as RoundReach[]
  cards.set(
    'centre:0:0',
    <ReachCell
      key="centre:0:0"
      rows={finalists.map((t) => ({ team: t, probability: t.p_title }))}
      accent
    />,
  )

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">
          Projected bracket · {bracket.season - 1}-{String(bracket.season).slice(2)}
        </h2>
        <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-primary)]">
          {bracket.simulations.toLocaleString()} simulations
        </span>
      </div>

      <div
        className="card overflow-x-auto p-4"
        tabIndex={0}
        role="region"
        aria-label={`Projected playoff bracket for the ${bracket.season - 1}-${String(
          bracket.season,
        ).slice(2)} season. Scrollable.`}
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

          {geometry.nodes.map((node) => (
            <Slot
              key={`${node.side}:${node.depth}:${node.slot}`}
              node={node}
              content={cards.get(`${node.side}:${node.depth}:${node.slot}`)}
            />
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        First-round cards show the projected seeding and the exact
        best-of-seven probability for that matchup. Every later card names the
        likeliest occupant of the slot and its probability of{' '}
        <em>reaching</em> that round — a marginal from the simulation, not a
        winner advanced through a fixed bracket. Those are different numbers
        and only one of them survives being wrong about the seeding.
      </p>
    </section>
  )
}

function Slot({
  node,
  content,
}: {
  node: BracketNode
  content?: React.ReactNode
}) {
  const style = { left: node.x, top: node.y, width: node.width, height: node.height }
  if (!content) {
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
  return (
    <div
      className="absolute flex flex-col justify-center gap-0.5 rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1"
      style={style}
    >
      {content}
    </div>
  )
}

function SeriesCell({
  rows,
}: {
  rows: Array<{
    seed: number
    abbreviation: string | null
    name: string | null
    logo: string | null
    probability: number
    lead: boolean
  }>
}) {
  return (
    <>
      {rows.map((row) => (
        <div key={row.seed} className="flex items-center gap-1.5">
          <span className="w-2.5 shrink-0 font-numeric text-[9px] text-[var(--text-tertiary)]">
            {row.seed}
          </span>
          <TeamLogo
            logo={row.logo}
            abbreviation={row.abbreviation}
            name={row.name}
            size={14}
          />
          <span
            className={cn(
              'flex-1 truncate font-numeric text-[11px]',
              row.lead
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]',
            )}
          >
            {row.abbreviation ?? '—'}
          </span>
          <span
            className={cn(
              'numeric text-[11px]',
              row.lead
                ? 'text-[var(--accent-primary)]'
                : 'text-[var(--text-tertiary)]',
            )}
          >
            {pct(row.probability, 0)}
          </span>
        </div>
      ))}
    </>
  )
}

function ReachCell({
  rows,
  accent = false,
}: {
  rows: Cell[]
  accent?: boolean
}) {
  if (!rows.length) return null
  return (
    <>
      {rows.map(({ team, probability }) => (
        <div key={team.team_id} className="flex items-center gap-1.5">
          <TeamLogo
            logo={team.logo}
            abbreviation={team.abbreviation}
            name={team.name}
            size={14}
          />
          <span className="flex-1 truncate font-numeric text-[11px] text-[var(--text-secondary)]">
            {team.abbreviation ?? team.name}
          </span>
          <span
            className={cn(
              'numeric text-[11px]',
              accent
                ? 'text-[var(--accent-warn)]'
                : 'text-[var(--text-tertiary)]',
            )}
          >
            {pct(probability, 0)}
          </span>
        </div>
      ))}
    </>
  )
}

/**
 * Merge consecutive candidate pools: [[a,b],[c,d],[e,f],[g,h]] becomes
 * [[a,b,c,d],[e,f,g,h]].
 *
 * Two first-round series feed one conference semi-final, so the semi's
 * candidate pool is the union of the four teams below it. The pairing order
 * matters and is the bracket's, not the seeds': slots 0 and 1 are the 1/8
 * and 4/5 series, which is the half of the draw the 1 seed is in.
 */
function mergePairs<T>(groups: T[][]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < groups.length; i += 2) {
    out.push(groups.slice(i, i + 2).flat())
  }
  return out
}

function topTwo<T>(items: T[], score: (item: T) => number): T[] {
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, 2)
}
