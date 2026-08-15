import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { getAllStar, type AllStarEvent } from '@/lib/history'

export const metadata = { title: 'All-Star weekend' }
export const dynamic = 'force-static'

/**
 * All-Star weekend, archive-only.
 *
 * **Nothing here is forecast, and the page says so at the top rather than
 * in a footnote.** The sides are drafted the week before and exist for one
 * night; since 2024 the game is an untimed race to a target score. A margin
 * model trained on 82-game franchises has nothing to say about any of it,
 * and a probability printed beside these scores would be a category error,
 * not a feature.
 *
 * **What the source does not carry is stated.** ESPN publishes All-Star
 * weekend GAMES. The Saturday events — the three-point contest, the dunk
 * contest, the skills challenge — are not games and are not in the feed. An
 * archive that quietly omitted them would imply this is the whole weekend.
 */
export default function AllStarPage() {
  const archive = getAllStar()

  if (!archive || !archive.seasons.length) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No All-Star archive published</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">
          Run <code className="font-numeric">build_history</code> to generate{' '}
          <code>allstar.json</code>.
        </p>
      </div>
    )
  }

  const [latest, ...rest] = archive.seasons

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Exhibition</p>
        <h1 className="mt-1 text-2xl">All-Star weekend</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {archive.n_events} games across {archive.seasons.length} seasons,
          through every format the league has tried: East against West, the
          captain-drafted teams, the untimed race to a target score, and the
          three-team round robin.
        </p>
        <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          <strong className="text-[var(--accent-warn)]">
            No forecast appears on this page.
          </strong>{' '}
          The sides are drafted the week before and exist for one night, and
          several of these games are untimed races to a target score. A model
          fitted on 82-game franchises has nothing to say about them, so it
          does not say anything.
        </p>
      </header>

      <SeasonBlock
        label={latest.label}
        events={latest.events}
        featured
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm">Every All-Star game since 2004</h2>
        <div className="card divide-y divide-[var(--border-color)]">
          {rest.flatMap((season) =>
            season.events.map((event) => (
              <EventRow key={event.id} event={event} label={season.label} />
            )),
          )}
        </div>
      </section>

      <div className="card p-4">
        <h2 className="text-sm">What is not here</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {archive.note}
        </p>
      </div>
    </div>
  )
}

function SeasonBlock({
  label,
  events,
  featured = false,
}: {
  label: string
  events: AllStarEvent[]
  featured?: boolean
}) {
  if (!events.length) return null
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">{label} weekend</h2>
        {featured ? (
          <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            Most recent
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  )
}

function EventCard({ event }: { event: AllStarEvent }) {
  const homeWon = event.home_score > event.away_score
  return (
    <Link
      href={`/games/${event.id}`}
      className="card group block p-4 transition-colors hover:bg-[var(--card-hover)]"
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="eyebrow">{event.label}</span>
        <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
          {new Date(event.date).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            timeZone: 'America/New_York',
          })}
        </span>
      </div>

      <Side side={event.away} score={event.away_score} won={!homeWon} />
      <Side side={event.home} score={event.home_score} won={homeWon} />

      {event.venue ? (
        <p className="mt-3 border-t border-[var(--border-color)] pt-2 text-[11px] text-[var(--text-tertiary)]">
          {event.venue}
        </p>
      ) : null}

      <span className="mt-2 inline-flex items-center gap-1 font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-info)]">
        Box score ›
      </span>
    </Link>
  )
}

function Side({
  side,
  score,
  won,
}: {
  side: AllStarEvent['home']
  score: number
  won: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <TeamLogo
        logo={side.logo}
        abbreviation={side.abbreviation}
        name={side.name}
        size={24}
      />
      <span
        className={
          won
            ? 'min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]'
            : 'min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]'
        }
      >
        {side.name}
      </span>
      <span
        className={
          won
            ? 'numeric text-lg text-[var(--text-primary)]'
            : 'numeric text-lg text-[var(--text-tertiary)]'
        }
      >
        {score}
      </span>
    </div>
  )
}

function EventRow({ event, label }: { event: AllStarEvent; label: string }) {
  const homeWon = event.home_score > event.away_score
  return (
    <Link
      href={`/games/${event.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]"
    >
      <span className="w-16 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span
          className={
            homeWon ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
          }
        >
          {event.away.name} {event.away_score}
        </span>
        <span className="mx-1.5 text-[var(--text-tertiary)]">@</span>
        <span
          className={
            homeWon ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
          }
        >
          {event.home.name} {event.home_score}
        </span>
      </span>
      <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
        {event.label}
      </span>
    </Link>
  )
}
