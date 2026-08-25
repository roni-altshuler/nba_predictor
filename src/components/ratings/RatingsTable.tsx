'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { TeamLabel } from '@/components/primitives/TeamLogo'
import type { PowerRating } from '@/lib/artifacts'

/**
 * The power-ratings table, sortable.
 *
 * The server page passes the published rows; this component only reorders
 * them. **It computes no probability and no rating** — the `#` column stays
 * each team's published rank whatever the sort, because rank is a fact about
 * the team, not about the row's position on screen.
 *
 * Sorting is a three-state cycle per column: first click sorts (ascending
 * for text, descending for the rating), second click flips, third restores
 * the published order. Headers are real `<button>`s, so Enter and Space
 * activate them natively, and the active column carries `aria-sort`.
 */

export type RatingsSortKey = 'name' | 'conference' | 'elo'
export type SortDir = 'asc' | 'desc'
export interface RatingsSort {
  key: RatingsSortKey
  dir: SortDir
}

/** The order the artifact publishes: rating descending, rank ascending. */
const DEFAULT_SORT: RatingsSort = { key: 'elo', dir: 'desc' }

/** The direction a column sorts on its first click. */
const FIRST_DIR: Record<RatingsSortKey, SortDir> = {
  name: 'asc',
  conference: 'asc',
  elo: 'desc',
}

/**
 * Advance the sort state for a header click. `null` means the published
 * order — which IS rating descending, so the rating column two-cycles
 * (its third state equals its first) while text columns three-cycle.
 */
export function cycleRatingsSort(
  sort: RatingsSort | null,
  key: RatingsSortKey,
): RatingsSort | null {
  const active = sort ?? DEFAULT_SORT
  if (active.key !== key) return { key, dir: FIRST_DIR[key] }
  if (active.dir === FIRST_DIR[key])
    return { key, dir: active.dir === 'asc' ? 'desc' : 'asc' }
  return null
}

/** Reorder the published rows. `null` returns them exactly as published. */
export function sortRatings(
  teams: PowerRating[],
  sort: RatingsSort | null,
): PowerRating[] {
  if (!sort) return teams
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...teams].sort((a, b) => {
    if (sort.key === 'elo') return (a.elo - b.elo) * factor
    const av = (sort.key === 'name' ? a.name : a.conference) ?? ''
    const bv = (sort.key === 'name' ? b.name : b.conference) ?? ''
    return av.localeCompare(bv) * factor
  })
}

function SortableTh({
  label,
  columnKey,
  sort,
  onSort,
  className,
}: {
  label: string
  columnKey: RatingsSortKey
  sort: RatingsSort | null
  onSort: (key: RatingsSortKey) => void
  className?: string
}) {
  const effective = sort ?? DEFAULT_SORT
  const active = effective.key === columnKey
  return (
    <th
      scope="col"
      className={className}
      aria-sort={
        active
          ? effective.dir === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined
      }
    >
      {/* The button inherits the th's mono/size/weight/colour; uppercase and
          tracking are restated because the global button reset overrides
          them, and the header must not move a pixel. */}
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className="inline-flex items-center gap-1 uppercase tracking-[0.1em] transition-colors hover:text-[var(--text-primary)]"
      >
        {label}
        {active ? (
          <span aria-hidden="true" className="text-[var(--text-tertiary)]">
            {effective.dir === 'asc' ? '▲' : '▼'}
          </span>
        ) : null}
      </button>
    </th>
  )
}

export function RatingsTable({ teams }: { teams: PowerRating[] }) {
  const [sort, setSort] = useState<RatingsSort | null>(null)
  const rows = useMemo(() => sortRatings(teams, sort), [teams, sort])

  // The relative bar spans best-to-worst BY RATING, whatever the sort —
  // computed from the published order, where first is best and last worst.
  const best = teams[0]?.elo ?? 1500
  const worst = teams[teams.length - 1]?.elo ?? 1500
  const span = Math.max(best - worst, 1)

  const onSort = (key: RatingsSortKey) =>
    setSort((current) => cycleRatingsSort(current, key))

  return (
    <div className="card overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th scope="col">#</th>
            <SortableTh label="Team" columnKey="name" sort={sort} onSort={onSort} />
            <SortableTh
              label="Conference"
              columnKey="conference"
              sort={sort}
              onSort={onSort}
            />
            <SortableTh
              label="Elo"
              columnKey="elo"
              sort={sort}
              onSort={onSort}
              className="numeric text-right"
            />
            <th scope="col" className="w-1/3">Relative</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((team) => (
            <tr key={team.team_id}>
              <td className="numeric text-[var(--text-tertiary)]">{team.rank}</td>
              <td>
                <Link
                  href={`/teams/${team.abbreviation}`}
                  className="text-[var(--text-primary)] hover:underline"
                >
                  <TeamLabel
                    logo={team.logo}
                    abbreviation={team.abbreviation}
                    name={team.name}
                  />
                </Link>
              </td>
              <td className="text-[var(--text-tertiary)]">
                {team.conference?.replace(' Conference', '') ?? '—'}
              </td>
              <td className="numeric text-right text-[var(--text-primary)]">
                {Math.round(team.elo)}
              </td>
              <td>
                <div className="prob-track">
                  <div
                    className="prob-fill"
                    style={{ width: `${((team.elo - worst) / span) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
