'use client'

import { useEffect, useMemo, useState } from 'react'

import { GameCard } from '@/components/forecast/GameCard'
import type { GameForecast } from '@/lib/artifacts'
import { easternDay } from '@/lib/courtside'
import { dayLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

const control = 'min-h-[44px] rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-3 font-numeric text-xs text-[var(--text-secondary)] hover:border-[var(--border-hover)] disabled:cursor-not-allowed disabled:opacity-40'

export function validSlateDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function offsetDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

/** One published day's games, with a shareable date/team and real history entries. */
export function DailySlate({ games, initialDay }: { games: GameForecast[]; initialDay: string }) {
  const [selection, setSelection] = useState({ day: initialDay, team: '' })
  const [ready, setReady] = useState(false)
  const teams = useMemo(() => [...new Map(games.flatMap(game => [game.home, game.away])
    .map(side => [side.abbreviation, side])).values()].sort((a, b) => a.name.localeCompare(b.name)), [games])

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search)
      const day = params.get('date')
      const team = params.get('team') ?? ''
      setSelection({ day: validSlateDay(day) ? day : initialDay,
        team: teams.some(side => side.abbreviation === team) ? team : '' })
    }
    restore()
    setReady(true)
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [initialDay, teams])

  const select = (day: string, team = selection.team) => {
    const url = new URL(window.location.href)
    url.searchParams.set('date', day)
    if (team) url.searchParams.set('team', team)
    else url.searchParams.delete('team')
    window.history.pushState(null, '', url)
    setSelection({ day, team })
  }
  const byDay = useMemo(() => {
    const groups = new Map<string, GameForecast[]>()
    for (const game of games) {
      if (selection.team && ![game.home.abbreviation, game.away.abbreviation].includes(selection.team)) continue
      const day = easternDay(game.date_utc)
      groups.set(day, [...(groups.get(day) ?? []), game])
    }
    return groups
  }, [games, selection.team])
  const dates = [...byDay.keys()].sort()
  const previous = dates.filter(day => day < selection.day).at(-1)
  const next = dates.find(day => day > selection.day)
  const slate = [...(byDay.get(selection.day) ?? [])].sort((a, b) => a.date_utc.localeCompare(b.date_utc))
  const rail = Array.from({ length: 7 }, (_, index) => offsetDay(selection.day, index - 3))

  return (
    <section aria-label="Daily slate" data-ready={ready}>
      <div className="card mb-5 p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-2">
            <span className="eyebrow">Game date · Eastern time</span>
            <input type="date" aria-label="Game date" value={selection.day} className={control} style={{ colorScheme: 'dark' }}
              onChange={event => { if (validSlateDay(event.target.value)) select(event.target.value) }} />
          </label>
          <label className="flex min-w-0 flex-col gap-2">
            <span className="eyebrow">Franchise</span>
            <select aria-label="Filter by franchise" value={selection.team} className={`${control} max-w-full`}
              onChange={event => select(selection.day, event.target.value)}>
              <option value="">All teams</option>
              {teams.map(team => <option key={team.abbreviation} value={team.abbreviation}>{team.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-2 sm:flex">
          <button type="button" aria-label="Previous published slate" className={control} disabled={!previous}
            onClick={() => previous && select(previous)}>← Previous</button>
          <button type="button" className={control} onClick={() => select(easternDay(new Date().toISOString()))}>Today</button>
          <button type="button" aria-label="Next published slate" className={control} disabled={!next}
            onClick={() => next && select(next)}>Next →</button>
        </div>
        <p className="eyebrow mt-4 border-t border-[var(--border-color)] pt-3">Published games by date</p>
        <nav aria-label="Dates near selected day" className="mt-2 grid grid-cols-7 gap-1">
          {rail.map(day => {
            const count = byDay.get(day)?.length ?? 0
            const date = new Date(`${day}T12:00:00Z`)
            return <button key={day} type="button" aria-pressed={day === selection.day}
              aria-label={`${dayLabel(day)}, ${count} published ${count === 1 ? 'game' : 'games'}`}
              onClick={() => select(day)} className={cn('min-h-[76px] rounded-sm border px-1 py-2 font-numeric transition-colors',
                day === selection.day ? 'border-[var(--accent-brand)] bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hover)]')}>
              <span className="block text-[10px]">{date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
              <span className="numeric my-1 block text-lg">{date.getUTCDate()}</span>
              <span aria-hidden="true" className="block text-[10px] text-[var(--text-tertiary)]">{count}</span>
            </button>
          })}
        </nav>
      </div>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2" aria-live="polite" aria-atomic="true">
        <h2 className="text-lg">{dayLabel(selection.day)}</h2>
        <p className="font-numeric text-xs text-[var(--text-secondary)]">{slate.length} published {slate.length === 1 ? 'game' : 'games'}{selection.team ? ` · ${selection.team}` : ''}</p>
      </div>
      {slate.length ? <div className="grid gap-4 lg:grid-cols-2">
        {slate.map(game => <GameCard key={game.game_id} game={game} />)}
      </div> : <div className="card p-6">
        <h3 className="text-sm">No published games in this view</h3>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">This snapshot has no {selection.team ? `${selection.team} ` : ''}fixtures for this date.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {next && <button type="button" className={control} onClick={() => select(next)}>Go to next published slate →</button>}
          {selection.team && <button type="button" className={control} onClick={() => select(selection.day, '')}>Show all teams</button>}
        </div>
      </div>}
      <p className="mt-3 text-xs text-[var(--text-tertiary)]">Published pre-game probabilities. This slate does not imply live scores or confirmed player availability.</p>
    </section>
  )
}
