'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { gameDate, gameTime, num, pct, stamp } from '@/lib/format'
import { SCHEDULE_PAGE_SIZE, scheduleMonthLabel, scheduleSelection, type ScheduleSelection, type TeamScheduleGame } from '@/lib/teamSchedule'

const control = 'min-h-[44px] min-w-0 rounded-sm border border-[var(--border-color)] bg-[var(--input-bg)] px-3 font-numeric text-xs text-[var(--text-primary)] hover:border-[var(--border-hover)] disabled:cursor-not-allowed disabled:opacity-50'

function ScheduleUrlSync({ restore }: { restore: () => void }) {
  const query = useSearchParams().toString()
  useEffect(() => restore(), [query, restore])
  return null
}

/** Explore the published schedule; every number comes from the artifact. */
export function TeamSchedule({ games, team, season, generatedAt, trainedThrough }: {
  games: TeamScheduleGame[]
  team: string
  season: number | null
  generatedAt: string | null
  trainedThrough?: string | null
}) {
  const [selection, setSelection] = useState<ScheduleSelection>({ month: '', venue: '', count: SCHEDULE_PAGE_SIZE })
  const [ready, setReady] = useState(false)
  const months = useMemo(() => [...new Set(games.map(game => game.day.slice(0, 7)))].sort(), [games])
  const restore = useCallback(() => {
    if (window.location.pathname.toLowerCase() !== `/teams/${team.toLowerCase()}`) return
    setSelection(scheduleSelection(new URLSearchParams(window.location.search), months, games.length))
    setReady(true)
  }, [months, games.length, team])
  useEffect(() => {
    restore()
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [restore])

  const choose = (next: ScheduleSelection) => {
    const url = new URL(window.location.href)
    for (const [key, value] of [['scheduleMonth', next.month], ['scheduleVenue', next.venue], ['scheduleCount', next.count > SCHEDULE_PAGE_SIZE ? String(next.count) : '']]) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    url.hash = 'team-schedule'
    if (url.href !== window.location.href) window.history.pushState(null, '', url)
    setSelection(next)
  }
  const filtered = games.filter(game => (!selection.month || game.day.startsWith(selection.month))
    && (!selection.venue || (selection.venue === 'neutral' ? game.neutral
      : selection.venue === 'home' ? game.home && !game.neutral : !game.home && !game.neutral)))
  const visible = filtered.slice(0, selection.count)
  const more = filtered.length > visible.length

  return <section id="team-schedule" aria-labelledby="team-schedule-title" data-ready={ready} aria-busy={!ready} className="team-schedule mb-8 scroll-mt-20 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)]">
    <Suspense fallback={null}><ScheduleUrlSync restore={restore} /></Suspense>
    <div className="border-b border-[var(--border-color)] p-4 sm:p-5">
      <p className="eyebrow">{season ? `${season - 1}–${String(season).slice(2)} · regular-season forecasts` : 'Published schedule'}</p>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="team-schedule-title" className="text-lg">Next games</h2>
        <span className="font-numeric text-xs">{games.length} published fixtures</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Choose a month or court, then open a matchup. These are scheduled games, with pre-game forecasts rather than final scores.</p>
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--text-tertiary)]">Forecast published</dt><dd className="mt-1 font-numeric">{generatedAt ? stamp(generatedAt) : 'Unavailable'}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Results used through</dt><dd className="mt-1 font-numeric">{trainedThrough ? stamp(trainedThrough) : 'Unavailable'}</dd></div>
      </dl>
    </div>
    {games.length ? <>
      <div className="grid gap-3 border-b border-[var(--border-color)] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-5">
        <label className="min-w-0"><span className="eyebrow mb-2 block">Month · Eastern time</span>
          <select aria-label="Schedule month" disabled={!ready} value={selection.month} onChange={event => choose({ ...selection, month: event.target.value, count: SCHEDULE_PAGE_SIZE })} className={`${control} w-full`}>
            <option value="">All published months</option>{months.map(month => <option key={month} value={month}>{scheduleMonthLabel(month)}</option>)}
          </select>
        </label>
        <label className="min-w-0"><span className="eyebrow mb-2 block">Court</span>
          <select aria-label="Schedule court" disabled={!ready} value={selection.venue} onChange={event => choose({ ...selection, venue: event.target.value as ScheduleSelection['venue'], count: SCHEDULE_PAGE_SIZE })} className={`${control} w-full`}>
            <option value="">All courts</option><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option>
          </select>
        </label>
        <button type="button" className={control} disabled={!ready || (!selection.month && !selection.venue && selection.count === SCHEDULE_PAGE_SIZE)} onClick={() => choose({ month: '', venue: '', count: SCHEDULE_PAGE_SIZE })}>Reset schedule</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" className="px-4 py-3 font-numeric text-xs text-[var(--text-secondary)]">
        {ready ? `Showing ${visible.length} of ${filtered.length} published games${selection.month ? ` · ${scheduleMonthLabel(selection.month)}` : ''}${selection.venue ? ` · ${selection.venue}` : ''}` : 'Restoring schedule filters…'}
      </p>
      {visible.length ? <ul className="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)]">
        {visible.map(game => <li key={game.id} data-game-id={game.id}>
          <details className="group">
            <summary className="flex min-h-[80px] cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-brand)] sm:px-5 [&::-webkit-details-marker]:hidden">
              <div className="w-28 shrink-0"><p className="font-numeric text-xs">{gameDate(game.date)}</p><p className="mt-1 font-numeric text-[11px] text-[var(--text-tertiary)]">{gameTime(game.date)}</p></div>
              <TeamLogo logo={game.opponent.logo} name={game.opponent.name} abbreviation={game.opponent.abbreviation} size={36} />
              <div className="min-w-0 flex-1 basis-24"><p className="text-sm font-semibold">{game.opponent.name}</p><p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{game.neutral ? 'Neutral court' : game.home ? 'Home' : 'Away'} · scheduled</p></div>
              <div className="ml-auto text-right"><p className="font-numeric text-base">{pct(game.probability)}</p><p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{team} win probability</p></div>
              <span className="w-full text-[11px] text-[var(--text-tertiary)] sm:w-auto"><span className="group-open:hidden">Forecast details +</span><span className="hidden group-open:inline">Close details −</span></span>
            </summary>
            <div className="border-t border-[var(--border-color)] bg-[var(--card-hover)] p-4 sm:px-5">
              <p className="text-xs text-[var(--text-secondary)]">{game.venue ?? 'Venue unavailable'}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div><dt className="text-[var(--text-tertiary)]">Projected score · {team}–{game.opponent.abbreviation}</dt><dd className="mt-1 font-numeric text-sm">{Math.round(game.teamScore)}–{Math.round(game.opponentScore)}</dd></div>
                <div><dt className="text-[var(--text-tertiary)]">Projected total</dt><dd className="mt-1 font-numeric text-sm">{num(game.total)}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                <Link href={`/games/${game.id}`} prefetch={false} className="inline-flex min-h-[44px] items-center text-xs font-semibold underline underline-offset-4" aria-label={`Open ${team} ${game.home ? 'vs' : 'at'} ${game.opponent.name} matchup`}>Open matchup →</Link>
                <Link href={`/games?date=${game.day}&team=${team}`} prefetch={false} className="inline-flex min-h-[44px] items-center text-xs underline underline-offset-4">View this day’s slate →</Link>
              </div>
            </div>
          </details>
        </li>)}
      </ul> : <div className="border-t border-[var(--border-color)] p-5"><h3 className="text-sm">No published games match these filters</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">Try another court or reset the schedule to see this team’s published fixtures.</p></div>}
      {more ? <div className="border-t border-[var(--border-color)] p-4"><button type="button" className={`${control} w-full sm:w-auto`} disabled={!ready} onClick={() => choose({ ...selection, count: selection.count + SCHEDULE_PAGE_SIZE })}>Show {Math.min(SCHEDULE_PAGE_SIZE, filtered.length - visible.length)} more games</button></div> : null}
    </> : <div className="p-5"><h3 className="text-sm">Schedule forecast unavailable</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">This publication has no scheduled forecasts for {team}. An unavailable forecast does not mean a zero chance or a completed game.</p></div>}
    <p className="border-t border-[var(--border-color)] p-4 text-xs leading-relaxed text-[var(--text-tertiary)]">Published coverage only; this is not the complete league schedule. Preseason exhibition games are outside this regular-season forecast. Injuries and roster changes are not model inputs.</p>
  </section>
}
