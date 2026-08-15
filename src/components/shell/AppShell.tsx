'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * The app chrome: a fixed sidebar on desktop, a bottom tab bar on mobile.
 *
 * **There is no global search.** The site has six destinations, all one tap
 * away, and a search field printed in the chrome advertises a product bigger
 * than this one. The sibling soccer project removed its palette for exactly
 * this reason and the mobile bar's spare slot went to the evidence page
 * instead — the same choice is made here.
 */

const NAV = [
  { href: '/', label: 'Today', short: 'Today' },
  { href: '/season', label: 'Season', short: 'Season' },
  { href: '/games', label: 'Games', short: 'Games' },
  { href: '/ratings', label: 'Ratings', short: 'Ratings' },
  { href: '/accuracy', label: 'Accuracy', short: 'Record' },
  { href: '/about', label: 'How it works', short: 'About' },
]

// The mobile bar shows four. The record is one of them deliberately: the
// central claim of this product is that its probabilities are calibrated,
// and the page that shows whether that is true should not be two taps down.
const MOBILE_NAV = NAV.filter((item) =>
  ['/', '/season', '/games', '/accuracy'].includes(item.href),
)

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppShell({ children }: { children: React.ReactNode }) {
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
          <span className="font-numeric text-sm uppercase tracking-[0.22em] text-[var(--text-primary)]">
            Hardwood
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-px p-3">
          {NAV.map((item) => (
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
          ))}
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
        <Link
          href="/"
          className="font-numeric text-sm uppercase tracking-[0.22em] text-[var(--text-primary)]"
        >
          Hardwood
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
        className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-[var(--border-color)] bg-[var(--nav-bg)] md:hidden"
        aria-label="Primary"
      >
        {MOBILE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            className={cn(
              'flex min-h-[52px] items-center justify-center text-[11px] uppercase tracking-[0.1em]',
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
