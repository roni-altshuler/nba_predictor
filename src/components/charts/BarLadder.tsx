import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { cn } from '@/lib/utils'

/**
 * A labelled horizontal bar list: mark · label · bar · value.
 *
 * The home page's title odds and power ratings were a table and a row of
 * cards; both are now this. The bar is an aid to scanning — the reader's
 * eye finds the leader and the gap to third without reading a column —
 * and the number beside it is the claim, always printed as text
 * (DESIGN.md §7.2). **The caller computes `fill` from PUBLISHED numbers**
 * (a share of the leader, a position between the published best and
 * worst); this component draws what it is given and derives nothing.
 *
 * One measure, one hue: `--viz-model`, the validated model-series slot.
 * Rows that name a team are links, and only those rows highlight on
 * hover, because hover is an affordance and a static row cannot honour it.
 */
export interface BarLadderRow {
  key: string
  /** Where the row goes, when it goes somewhere. */
  href?: string
  logo?: string | null
  abbreviation?: string | null
  name: string
  /** The printed label beside the mark — usually the abbreviation. */
  label: string
  /** A small mono line under the label: projected record, playoffs odds. */
  caption?: string
  /** Bar length as a share of the track, 0–1. */
  fill: number
  /** The value, as text. The bar only illustrates it. */
  value: string
  /** A leading rank, when the list is a published ranking. */
  rank?: number
}

export function BarLadder({
  rows,
  ariaLabel,
  className,
}: {
  rows: BarLadderRow[]
  ariaLabel: string
  className?: string
}) {
  const showRank = rows.some((row) => row.rank !== undefined)

  return (
    <ol
      aria-label={ariaLabel}
      className={cn('card divide-y divide-[var(--border-color)]', className)}
    >
      {rows.map((row) => {
        const width = `${Math.round(Math.min(Math.max(row.fill, 0), 1) * 1000) / 10}%`
        const inner = (
          <>
            {showRank ? (
              <span className="numeric w-6 shrink-0 text-[10px] text-[var(--text-tertiary)]">
                {row.rank !== undefined ? `#${row.rank}` : ''}
              </span>
            ) : null}
            <TeamLogo
              logo={row.logo}
              abbreviation={row.abbreviation}
              name={row.name}
              size={22}
            />
            <span className="w-[7.25rem] shrink-0 sm:w-40">
              <span className="block truncate font-numeric text-xs text-[var(--text-primary)]">
                {row.label}
              </span>
              {row.caption ? (
                <span className="block truncate font-numeric text-[10px] text-[var(--text-tertiary)]">
                  {row.caption}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className="h-1.5 min-w-[2.5rem] flex-1 bg-[var(--muted-bg)]"
            >
              <span
                data-bar-fill
                className="block h-full"
                style={{ width, background: 'var(--viz-model)' }}
              />
            </span>
            <span className="numeric w-14 shrink-0 text-right text-xs text-[var(--text-primary)]">
              {row.value}
            </span>
          </>
        )
        const rowClass = 'flex items-center gap-2.5 px-3 py-2'
        return (
          <li key={row.key}>
            {row.href ? (
              <Link
                href={row.href}
                title={`${row.name} · ${row.value}`}
                className={cn(rowClass, 'transition-colors hover:bg-[var(--card-hover)]')}
              >
                {inner}
              </Link>
            ) : (
              <div className={rowClass} title={`${row.name} · ${row.value}`}>
                {inner}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
