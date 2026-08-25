import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BackLink } from '@/components/primitives/BackLink'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { roundName } from '@/lib/bracketLayout'
import { num, pct } from '@/lib/format'
import {
  getSeason,
  getSeasonsIndex,
  getSeries,
  seriesSlug,
  teamMetaFromStandings,
  type ArchiveGame,
} from '@/lib/history'
import { cn } from '@/lib/utils'

export const dynamic = 'force-static'

/**
 * One playoff series, game by game.
 *
 * The level the bracket cannot show. A bracket cell says "BOS 4 — MIA 1";
 * this says which games, by how much, where, and what the model made of each
 * one before it was played.
 *
 * **The series aggregate is printed with its n.** Six games is six games,
 * and a model that went 4-2 on a series is not evidence of anything on its
 * own — the honest record is on `/accuracy` over 25,749 of them. The line
 * at the foot of this page says so rather than leaving the reader to infer
 * a hit rate from a handful.
 */
export function generateStaticParams() {
  const index = getSeasonsIndex()
  const out: Array<{ season: string; seriesId: string }> = []
  for (const summary of index?.seasons ?? []) {
    const file = getSeason(summary.season)
    for (const series of file?.series ?? []) {
      // The SLUG, not the raw id — a colon in a path segment prerenders
      // fine and then 404s at runtime. See `seriesSlug`.
      out.push({ season: String(summary.season), seriesId: seriesSlug(series.series_id) })
    }
  }
  return out
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string; seriesId: string }>
}) {
  const { season, seriesId } = await params
  const found = getSeries(season, seriesId)
  if (!found) return { title: 'Series' }
  const { series } = found
  return {
    title: `${series.team_a} v ${series.team_b} · ${roundName(series.depth ?? 3)}`,
  }
}

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ season: string; seriesId: string }>
}) {
  const { season, seriesId } = await params
  const found = getSeries(season, seriesId)
  if (!found) notFound()

  const { file, series, games } = found
  const teams = teamMetaFromStandings(file.standings)
  const value = file.season
  const label = `${value - 1}-${String(value).slice(2)}`

  const a = series.team_a
  const b = series.team_b
  const scored = games.filter((g) => g.p_model !== undefined)
  const called = scored.filter((g) => {
    const homeWon = g.home_score > g.away_score
    return (g.p_model! > 0.5) === homeWon
  }).length

  return (
    <div>
      <header className="mb-6">
        <BackLink href={`/seasons/${value}`} label={`${label} season`} />
        <p className="eyebrow mt-3">
          {roundName(series.depth ?? 3)} · {label}
        </p>

        <div className="mt-3 flex items-center justify-between gap-4">
          <SeriesSide
            abbreviation={a}
            meta={a ? teams[a] : undefined}
            wins={series.wins_a}
            won={series.winner === a}
          />
          <span className="font-numeric text-xs text-[var(--text-tertiary)]">
            {series.completed ? 'final' : 'in progress'}
          </span>
          <SeriesSide
            abbreviation={b}
            meta={b ? teams[b] : undefined}
            wins={series.wins_b}
            won={series.winner === b}
            align="right"
          />
        </div>

        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          {games.length} {games.length === 1 ? 'game' : 'games'}
          {series.winner
            ? ` · ${teams[series.winner]?.name ?? series.winner} advanced`
            : ''}
        </p>
      </header>

      <section className="mb-6">
        <h2 className="mb-3 text-sm">Every game</h2>
        <div className="card divide-y divide-[var(--border-color)]">
          {games.map((game, index) => (
            <SeriesGame
              key={game.id}
              game={game}
              number={index + 1}
              teams={teams}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          Each game opens its own page with the period breakdown, the team
          totals and the full player box score.
        </p>
      </section>

      {scored.length ? (
        <section className="card p-4">
          <h2 className="text-sm">What the model made of it</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatTile
              label="Games it favoured correctly"
              valueClassName="mt-0.5 text-lg"
            >
              {`${called} of ${scored.length}`}
            </StatTile>
            <StatTile
              label="Mean probability on the winner"
              valueClassName="mt-0.5 text-lg"
            >
              {pct(
                scored.reduce((sum, g) => {
                  const homeWon = g.home_score > g.away_score
                  return sum + (homeWon ? g.p_model! : 1 - g.p_model!)
                }, 0) / scored.length,
                1,
              )}
            </StatTile>
            <StatTile
              label="Brier over the series"
              valueClassName="mt-0.5 text-lg"
            >
              {num(
                scored.reduce((sum, g) => {
                  const homeWon = g.home_score > g.away_score ? 1 : 0
                  return sum + (g.p_model! - homeWon) ** 2
                }, 0) / scored.length,
                4,
              )}
            </StatTile>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            <span className="text-[var(--accent-warn)]">A backtest</span>, and
            a sample of {scored.length}. The model was refit on games strictly
            earlier than each of these, so it never saw the result — but a
            record over a handful of games is not evidence in either
            direction. The one that means something is on{' '}
            <Link href="/accuracy" className="text-[var(--accent-info)] hover:underline">
              the accuracy page
            </Link>
            , over 25,749.
          </p>
        </section>
      ) : null}
    </div>
  )
}

function SeriesSide({
  abbreviation,
  meta,
  wins,
  won,
  align = 'left',
}: {
  abbreviation?: string | null
  meta?: { name: string; logo: string | null }
  wins: number
  won: boolean
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        align === 'right' && 'flex-row-reverse text-right',
      )}
    >
      <TeamLogo
        logo={meta?.logo}
        abbreviation={abbreviation}
        name={meta?.name}
        size={36}
      />
      <div className="min-w-0">
        {abbreviation ? (
          <Link
            href={`/teams/${abbreviation}`}
            className="truncate text-sm text-[var(--text-primary)] hover:underline"
          >
            {meta?.name ?? abbreviation}
          </Link>
        ) : (
          <p className="truncate text-sm text-[var(--text-secondary)]">—</p>
        )}
        <p
          className={cn(
            'numeric text-2xl',
            won ? 'text-[var(--accent-primary)]' : 'text-[var(--text-tertiary)]',
          )}
        >
          {wins}
        </p>
      </div>
    </div>
  )
}

function SeriesGame({
  game,
  number,
  teams,
}: {
  game: ArchiveGame
  number: number
  teams: Record<string, { name: string; logo: string | null }>
}) {
  const homeWon = game.home_score > game.away_score
  const said =
    game.p_model === undefined
      ? null
      : homeWon
        ? game.p_model
        : 1 - game.p_model

  return (
    <Link
      href={`/games/${game.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 transition-colors hover:bg-[var(--card-hover)]"
    >
      <span className="w-14 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
        Game {number}
      </span>
      <span className="w-16 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
        {new Date(game.date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', timeZone: 'America/New_York',
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
            homeWon ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]',
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

      {game.q_away && game.q_home ? (
        <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
          {game.q_away.join('·')} / {game.q_home.join('·')}
        </span>
      ) : null}

      <span
        className={cn(
          'w-14 shrink-0 text-right font-numeric text-[11px]',
          said === null
            ? 'text-[var(--text-tertiary)]'
            : said >= 0.5
              ? 'text-[var(--accent-primary)]'
              : 'text-[var(--accent-loss)]',
        )}
        title={
          said === null
            ? 'No out-of-sample forecast for this game'
            : 'What the model gave the side that won'
        }
      >
        {said === null ? '—' : pct(said, 0)}
      </span>
    </Link>
  )
}
