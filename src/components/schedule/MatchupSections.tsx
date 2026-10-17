'use client'

import Link from 'next/link'
import { useEffect } from 'react'

const upcoming = [
  ['forecast', 'Prediction'], ['availability', 'Availability'], ['context', 'Meetings'],
  ['shooting-context', 'Team trends'], ['market', 'Odds'],
] as const
const played = [
  ['player-box-scores', 'Players & box score'], ['game-stats', 'Game stats'],
  ['recorded-forecast', 'Model details'], ['shooting-context', 'Team trends'],
] as const

/** Reveal a requested disclosure without adding a history entry or losing Next state. */
function revealSection(id: string) {
  const target = document.getElementById(id)
  if (!target) return false
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true
  }
  target.tabIndex = -1
  target.scrollIntoView()
  target.focus({ preventScroll: true })
  return true
}

export function MatchupSections({ mode = 'upcoming' }: { mode?: 'upcoming' | 'played' }) {
  const sections = mode === 'played' ? played : upcoming
  useEffect(() => {
    const revealHash = () => {
      const id = window.location.hash.slice(1)
      if (sections.some(([target]) => target === id) || (mode === 'upcoming' && id === 'prediction-details') || (mode === 'played' && id === 'game-line-comparison')) revealSection(id)
    }
    revealHash()
    window.addEventListener('hashchange', revealHash)
    return () => window.removeEventListener('hashchange', revealHash)
  }, [mode, sections])
  return <nav aria-label="Matchup sections" className="mt-3 flex flex-wrap gap-2">
    {sections.map(([id, label]) => <a key={id} href={`#${id}`} onClick={event => {
      if (!revealSection(id)) return
      event.preventDefault()
      window.history.replaceState(window.history.state, '', `#${id}`)
    }} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border-color)] px-3 font-numeric text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)]">{label}</a>)}
    <Link href="/accuracy" className="inline-flex min-h-[44px] items-center px-3 font-numeric text-[11px] text-[var(--accent-info)] underline underline-offset-4">Model record →</Link>
  </nav>
}
