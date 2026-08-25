'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { canGoBack } from '@/lib/navstack'

/**
 * The one back control, used at the top of every detail page.
 *
 * A detail page is reachable from several places — a team page from the
 * standings, a game card or the ratings; a game page from the schedule, a
 * team page or the predictor — and a hardcoded parent href sends every one
 * of those readers somewhere they were not. So:
 *
 * - When the reader navigated here from another page on this site, the
 *   control is a true back: `router.back()` returns them to the exact page
 *   and scroll position they left, and it is labelled "Back".
 * - When they landed cold (a shared link, a search result), there is nothing
 *   behind them worth returning to, and the control is a normal link to the
 *   page's natural parent, labelled with that parent's name.
 *
 * The server renders the fallback form — without JS the contextual parent is
 * the right answer — and the label upgrades after mount.
 */
export function BackLink({
  href,
  label,
  className,
}: {
  /** The contextual parent — where a cold visitor should go "back" to. */
  href: string
  /** Name of that parent, e.g. "All seasons", "Upcoming games". */
  label: string
  className?: string
}) {
  const router = useRouter()
  const [hasHistory, setHasHistory] = useState(false)

  useEffect(() => {
    setHasHistory(canGoBack())
  }, [])

  const classes =
    className ??
    'inline-flex min-h-[36px] items-center gap-1.5 font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]'

  const arrow = (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )

  if (hasHistory) {
    return (
      <button type="button" onClick={() => router.back()} className={classes}>
        {arrow}
        Back
      </button>
    )
  }

  return (
    <Link href={href} className={classes}>
      {arrow}
      {label}
    </Link>
  )
}
