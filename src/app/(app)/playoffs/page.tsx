import Link from 'next/link'

import { TeamLabel } from '@/components/primitives/TeamLogo'
import {
  getPowerRatings,
  getSeasonProjections,
  type TeamProjection,
} from '@/lib/artifacts'
import { pct, stamp } from '@/lib/format'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Playoff picture' }
export const dynamic = 'force-static'

const CONFERENCES = ['Eastern Conference', 'Western Conference'] as const

/** Seeds 1–6 qualify directly; 7–10 enter the play-in. */
const DIRECT_MAX = 6

/**
 * The play-in band is bracketed by two amber hairlines — at the 6/7
 * boundary and again at the 10/miss cut — because those are the two lines
 * that decide a team's season. Amber is this site's play-in colour.
 */
const WARN_EDGE = 'border-l border-l-[var(--accent-warn)]'
const HAIR_EDGE = 'border-l border-l-[var(--border-color)]'

/**
 * The playoff picture: one row per team, one column per seed, each cell the
 * probability of finishing there.
 *
 * **The seed column is a DISTRIBUTION, not a projected seed** — the same
 * call the projected bracket makes, for the same reason: advancing a modal
 * seeding compounds one assumption into a board nobody simulated. What a
 * team actually has is a spread over seeds, and this page is that spread.
 */
export default function PlayoffsPage() {
  const projections = getSeasonProjections()
  const ratings = getPowerRatings()

  if (!projections) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No projection published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">forecast_season</code> to generate one.
        </p>
      </div>
    )
  }

  const meta = new Map((ratings?.teams ?? []).map((t) => [t.team_id, t]))

  // The columns come from the artifact, not from a hard-coded league shape.
  const seeds = [
    ...new Set(
      projections.teams.flatMap((t) =>
        Object.keys(t.seed_distribution).map(Number),
      ),
    ),
  ].sort((a, b) => a - b)
  const direct = seeds.filter((s) => s <= DIRECT_MAX).length
  const playIn = seeds.length - direct

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">
          Season {projections.season} ·{' '}
          {projections.simulations.toLocaleString()} simulations
        </p>
        <h1 className="mt-1 text-2xl">Playoff picture</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          The chance each team finishes at every conference seed — 1–6
          qualify directly, 7–10 enter the play-in.
        </p>
      </header>

      {CONFERENCES.map((conference) => {
        const members = projections.teams
          .filter((t) => t.conference === conference)
          .sort((a, b) => b.p_playoffs - a.p_playoffs || b.wins - a.wins)
        if (!members.length) return null
        return (
          <section key={conference} className="mb-8">
            <h2 className="mb-3 text-sm">{conference}</h2>
            <div className="card overflow-x-auto">
              <table className="min-w-[900px]">
                <thead>
                  <tr>
                    <th />
                    <th scope="colgroup" colSpan={direct}>
                      Direct
                    </th>
                    <th
                      scope="colgroup"
                      colSpan={playIn}
                      className={cn(WARN_EDGE, 'text-[var(--accent-warn)]')}
                    >
                      Play-in
                    </th>
                    <th className={WARN_EDGE} />
                    <th colSpan={2} className={HAIR_EDGE} />
                  </tr>
                  <tr>
                    <th scope="col">Team</th>
                    {seeds.map((seed) => (
                      <th
                        key={seed}
                        scope="col"
                        className={cn(
                          'text-right',
                          seed === DIRECT_MAX + 1 && WARN_EDGE,
                        )}
                      >
                        {seed}
                      </th>
                    ))}
                    <th scope="col" className={cn('text-right', WARN_EDGE)}>
                      Miss
                    </th>
                    <th scope="col" className={cn('text-right', HAIR_EDGE)}>
                      Play-in
                    </th>
                    <th scope="col" className="text-right">
                      Playoffs
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((team, index) => (
                    <Row
                      key={team.team_id}
                      team={team}
                      rank={index + 1}
                      seeds={seeds}
                      abbreviation={meta.get(team.team_id)?.abbreviation}
                      logo={meta.get(team.team_id)?.logo}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {projections.model_version} · generated{' '}
        {stamp(projections.generated_at)}
      </p>
    </div>
  )
}

function Row({
  team,
  rank,
  seeds,
  abbreviation,
  logo,
}: {
  team: TeamProjection
  rank: number
  seeds: number[]
  abbreviation?: string
  logo?: string | null
}) {
  return (
    <tr>
      <td className="whitespace-nowrap">
        <span className="inline-flex items-center gap-2.5">
          <span className="w-4 shrink-0 text-right font-numeric text-[10px] text-[var(--text-tertiary)]">
            {rank}
          </span>
          {abbreviation ? (
            <Link
              href={`/teams/${abbreviation}`}
              className="text-[var(--text-primary)] hover:underline"
            >
              <TeamLabel
                logo={logo}
                abbreviation={abbreviation}
                name={team.name}
                size={18}
              />
            </Link>
          ) : (
            <span className="text-[var(--text-primary)]">{team.name}</span>
          )}
        </span>
      </td>
      {seeds.map((seed) => (
        <SeedCell
          key={seed}
          p={team.seed_distribution[String(seed)]}
          className={seed === DIRECT_MAX + 1 ? WARN_EDGE : undefined}
        />
      ))}
      <SeedCell p={missProbability(team)} className={WARN_EDGE} />
      <td
        className={cn(
          'numeric whitespace-nowrap text-right text-[11px] text-[var(--text-tertiary)]',
          HAIR_EDGE,
        )}
      >
        {longshot(team.p_play_in)}
      </td>
      <td className="numeric whitespace-nowrap text-right text-[11px] text-[var(--text-primary)]">
        {longshot(team.p_playoffs)}
      </td>
    </tr>
  )
}

/**
 * One seed probability. **Absent renders as absent**: a seed this team never
 * reached in the simulation is an empty cell, never 0.0%.
 */
function SeedCell({ p, className }: { p?: number; className?: string }) {
  if (!p) return <td className={className} />
  const step = ramp(p)
  return (
    <td
      className={cn('numeric whitespace-nowrap text-right text-[11px]', className)}
      style={{ background: step.bg, color: step.fg }}
    >
      {longshot(p)}
    </td>
  )
}

/**
 * Background tint by magnitude, off the sequential ramp. Colour is an aid —
 * the number in the cell is the claim — and the two brightest steps flip to
 * dark text because white fails contrast on them.
 */
function ramp(p: number): { bg: string; fg: string } {
  if (p > 0.5) return { bg: 'var(--viz-seq-5)', fg: 'var(--accent-on-primary)' }
  if (p > 0.3) return { bg: 'var(--viz-seq-4)', fg: 'var(--accent-on-primary)' }
  if (p > 0.15) return { bg: 'var(--viz-seq-3)', fg: 'var(--text-primary)' }
  if (p > 0.05) return { bg: 'var(--viz-seq-2)', fg: 'var(--text-primary)' }
  return { bg: 'var(--viz-seq-1)', fg: 'var(--text-secondary)' }
}

/** A probability as text, honest at the tail — the NFL sibling's formatter. */
function longshot(value: number): string {
  if (value < 0.001) return '<0.1%'
  return pct(value, 1)
}

/**
 * Outside the top ten — 11th or worse, missing even the play-in.
 *
 * The artifact distributes over seeds 1–10 only, so this is the complement
 * of the published distribution, not a new number: the mass the simulation
 * left unassigned. The artifact carries four decimals, so a remainder under
 * half a display unit cannot be told from rounding and renders as absent.
 */
function missProbability(team: TeamProjection): number {
  const assigned = Object.values(team.seed_distribution).reduce(
    (a, b) => a + b,
    0,
  )
  const remainder = 1 - assigned
  return remainder < 0.0005 ? 0 : remainder
}
