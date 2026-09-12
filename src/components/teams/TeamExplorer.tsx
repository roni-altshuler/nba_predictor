import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { PowerRating } from '@/lib/artifacts'
import { groupByDivision } from '@/lib/divisions'

/**
 * Every franchise as a mark, grouped conference → division, each a link to
 * its team page with a one-line caption under it. A place to wander: the
 * rest of the home page ranks, and a ranking only shows the reader the
 * teams it already decided were interesting.
 *
 * The caption is whatever the caller has published for the team — a
 * projected record when the season projection exists, otherwise the
 * rating — and the section heading names which.
 */
export interface ExplorerRow {
  team: PowerRating
  caption: string
}

export function TeamExplorer({ rows }: { rows: ExplorerRow[] }) {
  const groups = groupByDivision(rows, (row) => row.team)

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((group) => (
        <section key={group.conference} aria-label={group.conference}>
          <h3 className="eyebrow">{group.short}</h3>
          {group.divisions.map((division) => (
            <div key={division.name} className="mt-2 flex items-center gap-2">
              <span className="w-16 shrink-0 font-numeric text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                {division.name}
              </span>
              <ul className="grid flex-1 grid-cols-5 gap-1" aria-label={division.name}>
                {division.items.map(({ team, caption }) => (
                  <li key={team.team_id}>
                    <Link
                      href={`/teams/${team.abbreviation}`}
                      title={`${team.name} · ${caption}`}
                      className="card flex min-h-[44px] flex-col items-center gap-1 px-1 py-2"
                    >
                      <TeamLogo
                        logo={team.logo}
                        abbreviation={team.abbreviation}
                        name={team.name}
                        size={28}
                      />
                      <span className="font-numeric text-[10px] text-[var(--text-primary)]">
                        {team.abbreviation}
                      </span>
                      <span className="numeric text-[10px] text-[var(--text-tertiary)]">
                        {caption}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
