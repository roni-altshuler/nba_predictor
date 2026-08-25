'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { PageTransition } from '@/components/motion/PageTransition'
import { AmbientBackground } from '@/components/shell/AmbientBackground'
import { EASE_OUT } from '@/lib/motion'
import { recordVisit } from '@/lib/navstack'
import { cn } from '@/lib/utils'

// The chalk court never runs on the server: ssr:false keeps the canvas out
// of the prerendered HTML (zero CLS, zero hydration cost on crawlers), the
// same loader pattern as the NFL sibling's chalkboard.
const CourtField = dynamic(() => import('@/components/background/CourtField'), {
  ssr: false,
})

/**
 * The app chrome: a fixed sidebar on desktop, a bottom tab bar on mobile.
 *
 * **There is no global search.** Every destination is one tap from here, and
 * a search field printed in the chrome advertises a product bigger than this
 * one. The sibling soccer project removed its command palette for exactly
 * this reason.
 *
 * **The mobile bar is four destinations plus More.** Twelve routes cannot
 * ride a five-slot bar, and the previous bar simply dropped seven of them —
 * on a phone, five pages of this site were reachable only by URL. The sheet
 * behind More lists everything. The record keeps a permanent slot
 * deliberately: the central claim of this product is that its probabilities
 * are calibrated, and the page that shows whether that is true should not be
 * two taps down.
 *
 * **"Seasons" is a destination AND a menu** (desktop). The row links to the
 * archive index; the chevron beside it opens the list of 23 seasons. Both
 * affordances, separately labelled.
 */

export interface SeasonLink {
  season: number
  label: string
  champion: string | null
}

const NAV = [
  { href: '/', label: 'Today', short: 'Today' },
  { href: '/preview', label: 'Season preview', short: 'Preview' },
  { href: '/season', label: 'Current season', short: 'Season' },
  { href: '/games', label: 'Games', short: 'Games' },
  { href: '/seasons', label: 'Seasons', short: 'Seasons', menu: true },
  { href: '/bracket', label: 'Bracket', short: 'Bracket' },
  { href: '/playoffs', label: 'Playoff picture', short: 'Playoffs' },
  { href: '/allstar', label: 'All-Star', short: 'All-Star' },
  { href: '/upsets', label: 'Upsets', short: 'Upsets' },
  { href: '/predict', label: 'Head to head', short: 'H2H' },
  { href: '/ratings', label: 'Ratings', short: 'Ratings' },
  { href: '/accuracy', label: 'Accuracy', short: 'Record' },
  { href: '/about', label: 'How it works', short: 'About' },
]

const MOBILE_BAR = ['/', '/games', '/season', '/accuracy']
const MOBILE_NAV = NAV.filter((item) => MOBILE_BAR.includes(item.href))
const MOBILE_MORE = NAV.filter((item) => !MOBILE_BAR.includes(item.href))

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
  const reduced = useReducedMotion()
  const [moreOpen, setMoreOpen] = useState(false)

  // Feed the in-app history stack that <BackLink> reads.
  useEffect(() => {
    recordVisit(pathname)
  }, [pathname])

  // Navigating closes the sheet — the tap already answered it.
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  const moreActive = MOBILE_MORE.some((item) => isActive(pathname, item.href))

  return (
    // No background on this wrapper, deliberately: the body paints the
    // black, the chalk-court canvas sits at z-index -1 above it, and an
    // opaque wrapper here would put a wall between the two.
    <div className="min-h-screen">
      <CourtField />
      <AmbientBackground />
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
          <span className="ml-2.5 font-numeric text-sm uppercase tracking-[0.22em] text-[var(--accent-brand)]">
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
                    ? 'border-l-2 border-[var(--accent-brand)] bg-[var(--card-hover)] pl-[10px] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-[var(--shell-topbar-h)] items-center border-b border-[var(--border-color)] bg-[var(--nav-bg)] px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={20} height={20} aria-hidden="true" />
          <span className="font-numeric text-sm uppercase tracking-[0.22em] text-[var(--accent-brand)]">
            Hardwood
          </span>
        </Link>
      </header>

      <div className="md:ml-[var(--shell-sidebar-w)]">
        <main id="main" className="px-4 pb-8 pt-6 md:px-8">
          <div className="mx-auto w-full max-w-shell">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>

        {/* The footer rides the content column so every reader sees it —
            the previous home of this text was the desktop sidebar, which a
            phone never renders. */}
        <footer className="px-4 pb-28 md:px-8 md:pb-10">
          <div className="mx-auto w-full max-w-shell border-t border-[var(--border-color)] pt-4">
            <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
              Forecasts are scored against the closing line. Nothing here is
              betting advice.{' '}
              <Link
                href="/about"
                className="text-[var(--accent-info)] hover:underline"
              >
                How it works
              </Link>
            </p>
          </div>
        </footer>
      </div>

      {/* Mobile "More" sheet. Sits above the tab bar; closes on navigation,
          Escape, or a tap on the overlay. */}
      <AnimatePresence>
        {moreOpen ? (
          <MoreSheet
            pathname={pathname}
            reduced={!!reduced}
            onClose={() => setMoreOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      {/* Mobile bottom bar. 44px minimum tap target — anything smaller fails
          the responsive audit. */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-[var(--border-color)] bg-[var(--nav-bg)] pb-[env(safe-area-inset-bottom,0px)] md:hidden"
        aria-label="Primary"
      >
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-[52px] items-center justify-center px-1 text-center text-[10px] uppercase tracking-[0.06em]',
                active
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)]',
              )}
            >
              {active ? <TabIndicator reduced={!!reduced} /> : null}
              {item.short}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="mobile-more-sheet"
          className={cn(
            'relative flex min-h-[52px] items-center justify-center px-1 text-center text-[10px] uppercase tracking-[0.06em]',
            moreActive || moreOpen
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)]',
          )}
        >
          {moreActive ? <TabIndicator reduced={!!reduced} /> : null}
          More
        </button>
      </nav>
    </div>
  )
}

/**
 * The 2px accent bar marking the active mobile tab. A shared `layoutId`
 * makes it slide between tabs on navigation; under reduced motion it is a
 * plain static bar.
 */
function TabIndicator({ reduced }: { reduced: boolean }) {
  if (reduced) {
    return (
      <span
        aria-hidden="true"
        className="absolute left-3 right-3 top-0 h-[2px] bg-[var(--accent-brand)]"
      />
    )
  }
  return (
    <motion.span
      layoutId="bottomnav-active"
      aria-hidden="true"
      transition={{ duration: 0.3, ease: EASE_OUT }}
      className="absolute left-3 right-3 top-0 h-[2px] bg-[var(--accent-brand)]"
    />
  )
}

/**
 * Everything the four-slot bar cannot carry, as a bottom sheet. A grid of
 * plain labelled targets — no icons to learn, same order as the sidebar.
 */
function MoreSheet({
  pathname,
  reduced,
  onClose,
}: {
  pathname: string
  reduced: boolean
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 md:hidden" role="presentation">
      <motion.button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-[var(--overlay-bg)]"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduced ? undefined : { opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <motion.div
        id="mobile-more-sheet"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="More pages"
        tabIndex={-1}
        className="absolute bottom-[calc(52px+env(safe-area-inset-bottom,0px))] left-0 right-0 border-t border-[var(--border-color)] bg-[var(--nav-bg)] p-3 outline-none"
        initial={reduced ? false : { y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduced ? undefined : { y: 24, opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE_OUT }}
      >
        <nav aria-label="More pages" className="grid grid-cols-2 gap-px">
          {MOBILE_MORE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={cn(
                'flex min-h-[44px] items-center px-3 text-xs uppercase tracking-[0.12em] transition-colors',
                isActive(pathname, item.href)
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </motion.div>
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
          inside ? 'border-l-2 border-[var(--accent-brand)] bg-[var(--card-hover)]' : '',
        )}
      >
        <Link
          href={item.href}
          aria-current={inside ? 'page' : undefined}
          className={cn(
            'flex-1 px-3 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors',
            inside
              ? 'pl-[10px] text-[var(--text-primary)]'
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
