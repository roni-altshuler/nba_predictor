'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { AnimatedNumber } from '@/components/motion/AnimatedNumber'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { gameTime, num, signed } from '@/lib/format'
import type { Matchups } from '@/lib/history'

export interface ScheduledMeeting {
  id: string
  date: string
}

/**
 * Head-to-head: pick any two franchises, get the forecast.
 *
 * **Every pairing is precomputed and shipped as static JSON.** 870 ordered
 * pairs is a 115KB file, and a lookup cannot disagree with the game
 * forecasts the way a second inference path would. This is the same
 * reasoning the playoff layer uses to enumerate reachable pairings rather
 * than caching lazily — and it means this page needs no server round-trip
 * and works offline.
 *
 * The venue toggle is real, not cosmetic: home court is the single largest
 * non-rating term in the model, and swapping it is what makes the surface
 * honest about a neutral-court question having no answer here.
 */
export function MatchupPicker({
  data,
  scheduled = {},
}: {
  data: Matchups
  scheduled?: Record<string, ScheduledMeeting>
}) {
  const teams = [...data.teams].sort((a, b) => a.name.localeCompare(b.name))
  const [homeKey, setHome] = useState(teams[0]?.abbreviation ?? '')
  const [awayKey, setAway] = useState(teams[1]?.abbreviation ?? '')

  const lookup = useMemo(() => {
    const map = new Map<string, Matchups['matchups'][number]>()
    for (const m of data.matchups) map.set(`${m.home}|${m.away}`, m)
    return map
  }, [data.matchups])

  const home = teams.find((t) => t.abbreviation === homeKey)
  const away = teams.find((t) => t.abbreviation === awayKey)
  const result = lookup.get(`${homeKey}|${awayKey}`)
  const fixture = scheduled[`${homeKey}|${awayKey}`]

  const swap = () => {
    setHome(awayKey)
    setAway(homeKey)
  }

  return (
    <div>
      <div className="card p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Picker
            label="Away team"
            value={awayKey}
            onChange={setAway}
            teams={teams}
            disabled={homeKey}
          />
          <button
            type="button"
            onClick={swap}
            className="h-9 rounded-sm border border-[var(--border-color)] px-3 font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
            aria-label="Swap home and away"
          >
            Swap
          </button>
          <Picker
            label="Home team"
            value={homeKey}
            onChange={setHome}
            teams={teams}
            disabled={awayKey}
          />
        </div>
      </div>

      {home && away && result ? (
        <div className="card mt-4 p-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <Side team={away} elo={data.elo[away.abbreviation]} />
            <span className="font-numeric text-xs text-[var(--text-tertiary)]">
              at
            </span>
            <Side team={home} elo={data.elo[home.abbreviation]} align="right" />
          </div>

          <ProbabilityBar
            awayLabel={away.abbreviation}
            homeLabel={home.abbreviation}
            pHome={result.p_home}
          />

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border-color)] pt-4 sm:grid-cols-4">
            <Stat label="Projected margin">
              {result.exp_margin >= 0 ? home.abbreviation : away.abbreviation}{' '}
              <AnimatedNumber
                value={Math.abs(result.exp_margin)}
                format={(v) => signed(v)}
              />
            </Stat>
            <Stat label="Projected total">
              <AnimatedNumber
                value={result.exp_total}
                format={(v) => num(v, 1)}
              />
            </Stat>
            <Stat label="Projected score">
              <AnimatedNumber value={result.exp_away_score} />
              {'–'}
              <AnimatedNumber value={result.exp_home_score} />
            </Stat>
            <Stat label="Rating gap">
              <AnimatedNumber
                value={
                  (data.elo[home.abbreviation] ?? 1500) -
                  (data.elo[away.abbreviation] ?? 1500)
                }
                format={(v) => signed(v, 0)}
              />
            </Stat>
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            {data.note} Home court is worth about two points in the current
            era — <em>Swap</em> shows exactly how much.
          </p>

          {/* When the hypothetical is also a real fixture, hand the reader
              the real one. This surface is a lookup at current ratings; the
              game page carries the schedule, the series history and both
              sides' form. */}
          {fixture ? (
            <Link
              href={`/games/${fixture.id}`}
              className="mt-3 inline-flex items-center gap-1.5 font-numeric text-[11px] text-[var(--accent-info)] hover:underline"
            >
              They meet {gameTime(fixture.date)} — full match detail
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ) : (
            <p className="mt-3 font-numeric text-[11px] text-[var(--text-tertiary)]">
              No scheduled meeting with these two in this venue order.
            </p>
          )}
        </div>
      ) : (
        <p className="card mt-4 p-4 text-xs text-[var(--text-tertiary)]">
          Pick two different teams to see a forecast.
        </p>
      )}
    </div>
  )
}

function Picker({
  label,
  value,
  onChange,
  teams,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  teams: Matchups['teams']
  disabled: string
}) {
  const id = `picker-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="eyebrow mb-1.5 block">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-sm border border-[var(--border-color)] bg-[var(--input-bg)] px-2 font-numeric text-xs text-[var(--text-primary)] focus-visible:border-[var(--accent-primary)]"
      >
        {teams.map((team) => (
          <option
            key={team.abbreviation}
            value={team.abbreviation}
            disabled={team.abbreviation === disabled}
          >
            {team.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function Side({
  team,
  elo,
  align = 'left',
}: {
  team: Matchups['teams'][number]
  elo?: number
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-3 ${
        align === 'right' ? 'flex-row-reverse text-right' : ''
      }`}
    >
      <TeamLogo
        logo={team.logo}
        abbreviation={team.abbreviation}
        name={team.name}
        size={40}
      />
      <div className="min-w-0">
        <p className="truncate text-sm text-[var(--text-primary)]">{team.name}</p>
        <p className="numeric text-[11px] text-[var(--text-tertiary)]">
          {elo !== undefined ? Math.round(elo) : '—'}
        </p>
      </div>
    </div>
  )
}

function Stat({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">
        {children}
      </dd>
    </div>
  )
}
