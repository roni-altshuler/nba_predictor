'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { num } from '@/lib/format'

/**
 * The season-by-season backtest table, sortable.
 *
 * The server page flattens the benchmark artifact into plain rows; this
 * component only reorders them — it computes nothing, and a season with no
 * market column stays absent rather than filled in. Absent cells sort LAST
 * in either direction: "no line published" is not a very small Brier.
 *
 * Sorting is a three-state cycle per column: first click sorts, second
 * flips, third restores the published order (chronological, oldest first).
 * Headers are real `<button>`s, so Enter and Space activate them natively,
 * and the active column carries `aria-sort`.
 */

export interface SeasonRow {
  season: number
  n: number | null
  modelBrier: number | null
  marketBrier: number | null
  gap: number | null
}

export type SeasonSortKey = 'season' | 'n' | 'modelBrier' | 'marketBrier' | 'gap'
export type SortDir = 'asc' | 'desc'
export interface SeasonSort {
  key: SeasonSortKey
  dir: SortDir
}

/** The order the artifact publishes: chronological, oldest season first. */
const DEFAULT_SORT: SeasonSort = { key: 'season', dir: 'asc' }

/** The direction a column sorts on its first click. */
const FIRST_DIR: Record<SeasonSortKey, SortDir> = {
  season: 'asc',
  n: 'desc',
  modelBrier: 'asc',
  marketBrier: 'asc',
  gap: 'asc',
}

/**
 * Advance the sort state for a header click. `null` means the published
 * order — which IS season ascending, so the season column two-cycles while
 * every other column three-cycles back to it.
 */
export function cycleSeasonSort(
  sort: SeasonSort | null,
  key: SeasonSortKey,
): SeasonSort | null {
  const active = sort ?? DEFAULT_SORT
  if (active.key !== key) return { key, dir: FIRST_DIR[key] }
  if (active.dir === FIRST_DIR[key])
    return { key, dir: active.dir === 'asc' ? 'desc' : 'asc' }
  return null
}

/** Reorder the published rows. `null` returns them exactly as published. */
export function sortSeasonRows(
  rows: SeasonRow[],
  sort: SeasonSort | null,
): SeasonRow[] {
  if (!sort) return rows
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[sort.key]
    const bv = b[sort.key]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return (av - bv) * factor
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
  columnKey: SeasonSortKey
  sort: SeasonSort | null
  onSort: (key: SeasonSortKey) => void
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

export function SeasonTable({ rows }: { rows: SeasonRow[] }) {
  const [sort, setSort] = useState<SeasonSort | null>(null)
  const sorted = useMemo(() => sortSeasonRows(rows, sort), [rows, sort])

  const onSort = (key: SeasonSortKey) =>
    setSort((current) => cycleSeasonSort(current, key))

  return (
    <div className="card overflow-x-auto">
      <table>
        <thead>
          <tr>
            <SortableTh label="Season" columnKey="season" sort={sort} onSort={onSort} />
            <SortableTh
              label="Games"
              columnKey="n"
              sort={sort}
              onSort={onSort}
              className="numeric text-right"
            />
            <SortableTh
              label="Model Brier"
              columnKey="modelBrier"
              sort={sort}
              onSort={onSort}
              className="numeric text-right"
            />
            <SortableTh
              label="Market Brier"
              columnKey="marketBrier"
              sort={sort}
              onSort={onSort}
              className="numeric text-right"
            />
            <SortableTh
              label="Gap"
              columnKey="gap"
              sort={sort}
              onSort={onSort}
              className="numeric text-right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.season}>
              <td className="numeric whitespace-nowrap">
                <Link
                  href={`/seasons/${row.season}`}
                  className="text-[var(--text-primary)] hover:underline"
                >
                  {row.season - 1}&ndash;{String(row.season).slice(2)}
                </Link>
              </td>
              <td className="numeric text-right">{row.n?.toLocaleString()}</td>
              <td className="numeric text-right">{num(row.modelBrier, 4)}</td>
              <td className="numeric text-right">
                {row.marketBrier !== null ? num(row.marketBrier, 4) : '—'}
              </td>
              <td className="numeric text-right">
                {row.gap !== null ? `+${num(row.gap, 4)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
