'use client'

import Link from 'next/link'

const sections = [
  ['forecast', 'Projection'],
  ['market', 'Market'],
  ['shooting-context', 'Shooting context'],
  ['availability', 'Availability'],
  ['context', 'Recent meetings'],
] as const

/** Section jumps keep Back pointed at the reader's date and franchise filter. */
export function MatchupSections() {
  return (
    <nav aria-label="Matchup sections" className="mt-3 flex flex-wrap gap-2">
      {sections.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={event => {
            const target = document.getElementById(id)
            if (!target) return
            event.preventDefault()
            window.history.replaceState(window.history.state, '', `#${id}`)
            target.tabIndex = -1
            target.scrollIntoView()
            target.focus({ preventScroll: true })
          }}
          className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border-color)] px-3 font-numeric text-xs text-[var(--text-secondary)] hover:border-[var(--border-hover)]"
        >
          {label}
        </a>
      ))}
      <Link href="/accuracy" className="inline-flex min-h-[44px] items-center px-3 font-numeric text-xs text-[var(--accent-info)] hover:underline">
        Model evidence →
      </Link>
    </nav>
  )
}
