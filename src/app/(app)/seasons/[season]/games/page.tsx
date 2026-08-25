import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BackLink } from '@/components/primitives/BackLink'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { pct } from '@/lib/format'
import {
  SEASON_TYPE_LABEL,
  getSeason,
  getSeasonsIndex,
  groupGamesByDay,
  teamMetaFromStandings,
  type ArchiveGame,
} from '@/lib/history'
import { cn } from '@/lib/utils'

export const dynamic = 'force-static'

export function generateStaticParams() {
  const index = getSeasonsIndex()
  return (index?.seasons ?? []).map((s) => ({ season: String(s.season) }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string }>
}) {
  const { season } = await params
  const value = Number(season)
  return { title: `${value - 1}-${String(value).slice(2)} results` }
}

/**
 * A whole season's fixtures.
 *
 * Grouped by month rather than paginated: a reader looking for a game knows
 * roughly when it was, and a "page 7 of 23" control is a worse index than
 * the calendar the sport already runs on. Each month is a `<details>` so
 * the page opens on a manageable amount of markup and every month is one
 * click — and, crucially, still present in the DOM for in-page search.
 */
export default async function SeasonGamesPage({
  params,
}: {
  params: Promise<{ season: string }>
}) {
  const { season } = await params
  const file = getSeason(season)
  if (!file) notFound()

  const value = file.season
  const label = `${value - 1}-${String(value).slice(2)}`
  const teams = teamMetaFromStandings(file.standings)

  const byMonth = new Map<string, ArchiveGame[]>()
  for (const [day, games] of groupGamesByDay(file.games)) {
    const month = day.slice(0, 7)
    const existing = byMonth.get(month)
    if (existing) existing.push(...games)
    else byMonth.set(month, [...games])
  }
  const months = Array.from(byMonth.entries())

  return (
    <div>
      <header className="mb-6">
        <BackLink href={`/seasons/${value}`} label={`${label} season`} />
        <h1 className="mt-2 text-2xl">{label} results</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {file.games.length.toLocaleString()} games. Every one links to its
          own page with the quarter breakdown, the box score and what the
          model would have said.
        </p>
      </header>

      {months.map(([month, games], index) => (
        <details key={month} open={index >= months.length - 2} className="mb-3">
          <summary className="cursor-pointer border-b border-[var(--border-color)] py-2 text-sm text-[var(--text-primary)]">
            {new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
              month: 'long', year: 'numeric', timeZone: 'UTC',
            })}
            <span className="ml-2 font-numeric text-[11px] text-[var(--text-tertiary)]">
              {games.length} games
            </span>
          </summary>
          <div className="card mt-2 divide-y divide-[var(--border-color)]">
            {games.map((game) => (
              <GameRow key={game.id} game={game} teams={teams} />
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

function GameRow({
  game,
  teams,
}: {
  game: ArchiveGame
  teams: Record<string, { name: string; logo: string | null }>
}) {
  const homeWon = game.home_score > game.away_score
  // Was the model's more-likely side the side that won?
  const called =
    game.p_model === undefined
      ? null
      : (game.p_model > 0.5) === homeWon

  return (
    <Link
      href={`/games/${game.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]"
    >
      <span className="w-12 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
        {new Date(game.date).toLocaleDateString('en-US', {
          month: 'numeric', day: 'numeric', timeZone: 'America/New_York',
        })}
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-2">
        <TeamLogo
          logo={teams[game.away]?.logo}
          abbreviation={game.away}
          name={teams[game.away]?.name}
          size={16}
        />
        <span
          className={cn(
            'numeric text-xs',
            !homeWon ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
          )}
        >
          {game.away} {game.away_score}
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">@</span>
        <TeamLogo
          logo={teams[game.home]?.logo}
          abbreviation={game.home}
          name={teams[game.home]?.name}
          size={16}
        />
        <span
          className={cn(
            'numeric text-xs',
            homeWon ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
          )}
        >
          {game.home} {game.home_score}
        </span>
        {game.ot > 0 ? (
          <span className="font-numeric text-[10px] text-[var(--accent-warn)]">
            {game.ot === 1 ? 'OT' : `${game.ot}OT`}
          </span>
        ) : null}
      </span>

      {game.type !== 2 ? (
        <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
          {SEASON_TYPE_LABEL[game.type]}
        </span>
      ) : null}

      {called !== null ? (
        <span
          className={cn(
            'w-16 shrink-0 text-right font-numeric text-[11px]',
            called ? 'text-[var(--accent-primary)]' : 'text-[var(--accent-loss)]',
          )}
          title={
            called
              ? 'The model favoured the side that won'
              : 'The model favoured the side that lost'
          }
        >
          {pct(homeWon ? game.p_model! : 1 - game.p_model!, 0)}
        </span>
      ) : (
        <span className="w-16 shrink-0 text-right font-numeric text-[11px] text-[var(--text-tertiary)]">
          —
        </span>
      )}
    </Link>
  )
}
