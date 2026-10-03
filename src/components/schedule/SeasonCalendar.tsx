'use client'

import { useState } from 'react'
import type { GameWeek } from '@/lib/artifacts'
import { WeekCalendar } from './WeekCalendar'

/** Mount calendars only on request; collapsed weeks do not render 1,200 chips. */
export function SeasonCalendar({ weeks }: { weeks: GameWeek[] }) {
  const [expanded, setExpanded] = useState(false)
  const [openWeeks, setOpenWeeks] = useState<number[]>(weeks[0] ? [weeks[0].week] : [])
  return <details className="card mt-8 p-4" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-[var(--text-secondary)]">Full season calendar <span className="ml-auto font-numeric text-xs text-[var(--text-tertiary)]">{weeks.length} weeks</span></summary>
    {expanded && <div>
      <p className="my-3 text-xs text-[var(--text-secondary)]">Weekly view · all game times are Eastern. Open a week to load its fixtures.</p>
      {weeks.map(week => <details key={week.week} id={`week-${week.week}`} open={openWeeks.includes(week.week)} className="mb-4"
        onToggle={event => {
          const open = event.currentTarget.open
          setOpenWeeks(previous => open ? previous.includes(week.week) ? previous : [...previous, week.week] : previous.filter(value => value !== week.week))
        }}>
        <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-3 border-b border-[var(--border-color)] py-2 text-sm">
          <span>Week {week.week}</span><span className="font-numeric text-xs text-[var(--text-tertiary)]">{date(week.start)} – {date(week.end)}</span>
          <span className="ml-auto font-numeric text-xs text-[var(--text-tertiary)]">{week.games} games</span>
        </summary>
        {openWeeks.includes(week.week) && <WeekCalendar week={week} />}
      </details>)}
    </div>}
  </details>
}

function date(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
