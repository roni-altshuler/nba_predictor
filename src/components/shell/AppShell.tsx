'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * The app chrome: a fixed sidebar on desktop, a bottom tab bar on mobile.
 *
 * **There is no global search.** Every destination is one tap from here, and
 * a search field printed in the chrome advertises a product bigger than this
 * one. The sibling soccer project removed its command palette for exactly
 * this reason, and the mobile bar's spare slot went to the evidence page
 * instead — the same choice is made here.
 *
 * **"Seasons" is a destination AND a menu.** The row links to the archive
 * index; the chevron beside it opens the list of 23 seasons. Making the
 * whole row a toggle would take the index page out of the navigation
 * entirely, and making it only a link would bury every individual season two
 * clicks deep. Both affordances, separately labelled.
 */

export interface SeasonLink {
  season: number
  label: string
  champion: string | null
}

const NAV = [
  { href: '/', label: 'Today', short: 'Today' },
  { href: '/season', label: 'Current season', short: 'Season' },
  { href: '/games', label: 'Games', short: 'Games' },
  { href: '/seasons', label: 'Seasons', short: 'Seasons', menu: true },
  { href: '/bracket', label: 'Bracket', short: 'Bracket' },
  { href: '/allstar', label: 'All-Star', short: 'All-Star' },
  { href: '/predict', label: 'Head to head', short: 'H2H' },
  { href: '/ratings', label: 'Ratings', short: 'Ratings' },
  { href: '/accuracy', label: 'Accuracy', short: 'Record' },
  { href: '/about', label: 'How it works', short: 'About' },
]

// The mobile bar shows five. The record is one of them deliberately: the
// central claim of this product is that its probabilities are calibrated,
// and the page that shows whether that is true should not be two taps down.
const MOBILE_NAV = NAV.filter((item) =>
  ['/', '/season', '/seasons', '/bracket', '/accuracy'].includes(item.href),
)

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppShell({
  children,
  seasons = [],
}: {
  children: React.ReactNode
  seasons?: SeasonLink[]
}) {
  const pathname = usePathname() || '/'

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className="fixed left-0 top-0 z-30 hidden h-full w-[var(--shell-sidebar-w)] flex-col border-r border-[var(--border-color)] bg-[var(--nav-bg)] md:flex"
        aria-label="Primary"
      >
        <Link
          href="/"
          className="flex h-[var(--shell-topbar-h)] items-center border-b border-[var(--border-color)] px-5"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={20} height={20} aria-hidden="true" />
          <span className="ml-2.5 font-numeric text-sm uppercase tracking-[0.22em] text-[var(--text-primary)]">
            Hardwood
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-px overflow-y-auto p-3">
          {NAV.map((item) =>
            item.menu ? (
              <SeasonsMenu
                key={item.href}
                item={item}
                seasons={seasons}
                pathname={pathname}
              />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'px-3 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors',
                  isActive(pathname, item.href)
                    ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="border-t border-[var(--border-color)] p-4">
          <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            Forecasts are scored against the closing line. Nothing here is
            betting advice.
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-[var(--shell-topbar-h)] items-center border-b border-[var(--border-color)] bg-[var(--nav-bg)] px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={20} height={20} aria-hidden="true" />
          <span className="font-numeric text-sm uppercase tracking-[0.22em] text-[var(--text-primary)]">
            Hardwood
          </span>
        </Link>
      </header>

      <main
        id="main"
        className="px-4 pb-24 pt-6 md:ml-[var(--shell-sidebar-w)] md:px-8 md:pb-12"
      >
        <div className="mx-auto w-full max-w-shell">{children}</div>
      </main>

      {/* Mobile bottom bar. 44px minimum tap target — anything smaller fails
          the responsive audit. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 border-t border-[var(--border-color)] bg-[var(--nav-bg)] md:hidden"
        aria-label="Primary"
      >
        {MOBILE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className={cn(
              'flex min-h-[52px] items-center justify-center px-1 text-center text-[10px] uppercase tracking-[0.06em]',
              isActive(pathname, item.href)
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)]',
            )}
          >
            {item.short}
          </Link>
        ))}
      </nav>
    </div>
  )
}

/**
 * Seasons: a link to the archive plus a disclosure listing every season.
 *
 * It opens automatically when the reader is already inside the archive, so
 * arriving on a season page does not hide the other 22 behind a click. The
 * list is scrollable rather than paged — 23 rows is a short list, and paging
 * it would be chrome around chrome.
 */
function SeasonsMenu({
  item,
  seasons,
  pathname,
}: {
  item: { href: string; label: string }
  seasons: SeasonLink[]
  pathname: string
}) {
  const inside = isActive(pathname, item.href)
  const [open, setOpen] = useState(inside)

  // Follow the route: navigating into the archive opens the list, and
  // navigating away closes it rather than leaving it hanging open over an
  // unrelated page.
  useEffect(() => {
    setOpen(inside)
  }, [inside])

  // Escape closes it, which is the one keyboard convention every disclosure
  // shares and the one readers try first.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!seasons.length) {
    return (
      <Link
        href={item.href}
        aria-current={inside ? 'page' : undefined}
        className={cn(
          'px-3 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors',
          inside
            ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
        )}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <div>
      <div
        className={cn(
          'flex items-center transition-colors',
          inside ? 'bg-[var(--card-hover)]' : '',
        )}
      >
        <Link
          href={item.href}
          aria-current={inside ? 'page' : undefined}
          className={cn(
            'flex-1 px-3 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors',
            inside
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
          )}
        >
          {item.label}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="seasons-menu"
          className="flex h-9 w-9 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <span className="sr-only">
            {open ? 'Hide the season list' : 'Show the season list'}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className={cn('transition-transform', open && 'rotate-180')}
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <ul
          id="seasons-menu"
          className="mb-1 max-h-[42vh] overflow-y-auto border-l border-[var(--border-color)] pl-2 ml-3"
        >
          {seasons.map((season) => {
            const href = `/seasons/${season.season}`
            const current = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <li key={season.season}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex items-baseline justify-between gap-2 px-2 py-1.5 font-numeric text-[11px] transition-colors',
                    current
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                  )}
                >
                  <span>{season.label}</span>
                  {season.champion ? (
                    <span className="text-[10px] text-[var(--accent-warn)]">
                      {season.champion}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
