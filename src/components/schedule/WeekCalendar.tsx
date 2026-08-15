import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast, GameWeek } from '@/lib/artifacts'
import { pct } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * One NBA week as a calendar, not a list.
 *
 * **The list was the problem.** A full week is forty-odd games, and at one
 * forecast card each that is a page you scroll for a minute to see a single
 * week. A calendar puts the whole week on one screen: seven columns, every
 * game a compact chip, and the detail one click away on a page that has room
 * for it.
 *
 * **Seven columns on desktop, one on a phone.** A 7-across grid at 375px
 * gives each day 50 pixels, which is not a calendar, it is a smear. Below
 * `md` this stacks into labelled day sections — still far shorter than the
 * card list it replaces, because the chips are a fifth the height.
 *
 * **Empty days are drawn.** A week with no Thursday game should show an
 * empty Thursday; collapsing it silently shifts every other column and makes
 * two weeks with different rest patterns look identical.
 */

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function WeekCalendar({ week }: { week: GameWeek }) {
  const byDay = new Map(week.days)
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(week.start, i)
    return { day, name: DAY_NAMES[i], games: byDay.get(day) ?? [] }
  })

  return (
    <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map(({ day, name, games }) => (
        <section
          key={day}
          className={cn(
            'rounded-sm border border-[var(--border-color)] p-2',
            games.length ? '' : 'md:opacity-45',
          )}
        >
          <h4 className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--border-color)] pb-1.5">
            <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              {name} {dayNumber(day)}
            </span>
            {games.length ? (
              <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
                {games.length}
              </span>
            ) : null}
          </h4>

          {games.length ? (
            <ul className="space-y-1">
              {games.map((game) => (
                <li key={game.game_id}>
                  <GameChip game={game} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-1 font-numeric text-[10px] text-[var(--text-tertiary)]">
              No games
            </p>
          )}
        </section>
      ))}
    </div>
  )
}

/**
 * One game, at the smallest size that still says something.
 *
 * The favourite is named and its probability printed as text — never a bar
 * or a colour alone at this size, where a bar would be four pixels of hue
 * carrying the only number on the chip.
 */
function GameChip({ game }: { game: GameForecast }) {
  const homeFavoured = game.p_home >= 0.5
  const favourite = homeFavoured ? game.home : game.away

  return (
    <Link
      href={`/games/${game.game_id}`}
      className="block rounded-sm px-1.5 py-1.5 transition-colors hover:bg-[var(--card-hover)]"
      aria-label={`${game.away.name} at ${game.home.name}, ${time(game.date_utc)}. ${favourite.name} favoured at ${pct(homeFavoured ? game.p_home : game.p_away, 0)}.`}
    >
      <span className="mb-1 block font-numeric text-[9px] text-[var(--text-tertiary)]">
        {time(game.date_utc)}
        {game.value?.flagged ? (
          <span className="ml-1 text-[var(--accent-primary)]">· edge</span>
        ) : null}
      </span>

      <Row side={game.away} favoured={!homeFavoured} probability={game.p_away} />
      <Row side={game.home} favoured={homeFavoured} probability={game.p_home} />
    </Link>
  )
}

function Row({
  side,
  favoured,
  probability,
}: {
  side: GameForecast['home']
  favoured: boolean
  probability: number
}) {
  return (
    <span className="flex items-center gap-1.5">
      <TeamLogo
        logo={side.logo}
        abbreviation={side.abbreviation}
        name={side.name}
        size={14}
      />
      <span
        className={cn(
          'flex-1 truncate font-numeric text-[11px]',
          favoured ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
        )}
      >
        {side.abbreviation}
      </span>
      <span
        className={cn(
          'numeric text-[10px]',
          favoured ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
        )}
      >
        {pct(probability, 0)}
      </span>
    </span>
  )
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })
}

function dayNumber(day: string): number {
  return Number(day.slice(8, 10))
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}
