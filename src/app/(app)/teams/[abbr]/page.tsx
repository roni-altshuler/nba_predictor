import Link from 'next/link'
import { notFound } from 'next/navigation'

import { RatingHistoryChart } from '@/components/charts/RatingHistoryChart'
import { BackLink } from '@/components/primitives/BackLink'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { getGameForecasts, getPowerRatings, getSeasonProjections } from '@/lib/artifacts'
import { gameDate, pct } from '@/lib/format'
import {
  getRatingHistory,
  getSeason,
  getSeasonsIndex,
  teamMetaFromStandings,
} from '@/lib/history'
import { cn } from '@/lib/utils'

export const dynamic = 'force-static'

export function generateStaticParams() {
  const ratings = getPowerRatings()
  return (ratings?.teams ?? []).map((t) => ({ abbr: t.abbreviation }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ abbr: string }>
}) {
  const { abbr } = await params
  const team = getPowerRatings()?.teams.find(
    (t) => t.abbreviation.toLowerCase() === abbr.toLowerCase(),
  )
  return { title: team?.name ?? abbr }
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ abbr: string }>
}) {
  const { abbr } = await params
  const key = abbr.toUpperCase()

  const ratings = getPowerRatings()
  const team = ratings?.teams.find((t) => t.abbreviation.toUpperCase() === key)
  if (!team) notFound()

  const projections = getSeasonProjections()
  const projection = projections?.teams.find((t) => t.team_id === team.team_id)

  const forecasts = getGameForecasts()
  const upcoming = (forecasts?.games ?? [])
    .filter(
      (g) =>
        g.home.abbreviation === team.abbreviation ||
        g.away.abbreviation === team.abbreviation,
    )
    .slice(0, 8)

  const history = getRatingHistory()
  const seasonsIndex = getSeasonsIndex()

  // The league band for the emphasis chart: 10th/90th percentile per season,
  // computed from the same rating history so it cannot disagree with the line.
  const band =
    history?.seasons.map((_, i) => {
      const column = Object.values(history.teams)
        .map((series) => series[i])
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)
      if (column.length < 5) return null
      const at = (q: number) => column[Math.floor(q * (column.length - 1))]
      return { low: at(0.1), high: at(0.9) }
    }) ?? []

  // Last completed season's record for this franchise.
  const latestSeason = seasonsIndex?.seasons[0]?.season
  const lastSeasonFile = latestSeason ? getSeason(latestSeason) : null
  const lastRecord = lastSeasonFile?.standings.find(
    (s) => s.abbreviation === team.abbreviation,
  )

  return (
    <div>
      <header className="mb-6">
        <BackLink href="/ratings" label="Power ratings" />
        <div className="mt-3 flex items-center gap-4">
          <TeamLogo
            logo={team.logo}
            abbreviation={team.abbreviation}
            name={team.name}
            size={56}
          />
          <div>
            <h1 className="text-2xl">{team.name}</h1>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              {team.conference} · power rating #{team.rank}
            </p>
          </div>
        </div>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Elo" className="card p-3" valueClassName="mt-1 text-lg">
          {String(Math.round(team.elo))}
        </StatTile>
        {projection ? (
          <>
            <StatTile
              label="Projected"
              className="card p-3"
              valueClassName="mt-1 text-lg"
            >
              {`${projection.wins.toFixed(1)}–${projection.losses.toFixed(1)}`}
            </StatTile>
            <StatTile
              label="Playoffs"
              className="card p-3"
              valueClassName="mt-1 text-lg"
            >
              {pct(projection.p_playoffs, 0)}
            </StatTile>
            <StatTile
              label="Title"
              className="card p-3"
              valueClassName="mt-1 text-lg"
            >
              {pct(projection.p_championship)}
            </StatTile>
          </>
        ) : (
          <StatTile
            label="Projection"
            className="card p-3"
            valueClassName="mt-1 text-lg"
          >
            —
          </StatTile>
        )}
      </section>

      {lastRecord ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm">
            Last season ·{' '}
            <Link
              href={`/seasons/${latestSeason}`}
              className="text-[var(--accent-info)] hover:underline"
            >
              {(latestSeason ?? 0) - 1}-{String(latestSeason).slice(2)}
            </Link>
          </h2>
          <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
            <StatTile label="Record">{`${lastRecord.wins}–${lastRecord.losses}`}</StatTile>
            <StatTile label="Home">{`${lastRecord.home_wins}–${lastRecord.home_losses}`}</StatTile>
            <StatTile label="Away">{`${lastRecord.away_wins}–${lastRecord.away_losses}`}</StatTile>
            <StatTile label="Net rating">
              {`${lastRecord.net_rating > 0 ? '+' : ''}${lastRecord.net_rating.toFixed(1)}`}
            </StatTile>
            <StatTile label="Conference">
              {`#${lastRecord.conference_rank ?? '—'}`}
            </StatTile>
          </div>
        </section>
      ) : null}

      {history && history.seasons.length > 2 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm">Rating history</h2>
          <div className="card p-4">
            <RatingHistoryChart
              seasons={history.seasons}
              values={history.teams[team.abbreviation] ?? []}
              band={band}
              label={team.name}
            />
          </div>
        </section>
      ) : null}

      {projection && Object.keys(projection.seed_distribution).length ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm">Where they finish</h2>
          <div className="card p-4">
            <SeedDistribution distribution={projection.seed_distribution} />
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm">Next games</h2>
        {upcoming.length ? (
          <div className="card divide-y divide-[var(--border-color)]">
            {upcoming.map((game) => {
              const isHome = game.home.abbreviation === team.abbreviation
              const opponent = isHome ? game.away : game.home
              const winProbability = isHome ? game.p_home : game.p_away
              return (
                <Link
                  key={game.game_id}
                  href={`/games/${game.game_id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
                >
                  <span className="w-20 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
                    {gameDate(game.date_utc)}
                  </span>
                  <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
                    {isHome ? 'vs' : '@'}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamLogo
                      logo={opponent.logo}
                      abbreviation={opponent.abbreviation}
                      name={opponent.name}
                      size={18}
                    />
                    <span className="truncate text-sm text-[var(--text-primary)]">
                      {opponent.name}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'ml-auto font-numeric text-sm',
                      winProbability >= 0.5
                        ? 'text-[var(--accent-primary)]'
                        : 'text-[var(--text-tertiary)]',
                    )}
                  >
                    {pct(winProbability)}
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <p className="card p-4 text-xs text-[var(--text-tertiary)]">
            No scheduled games in the published forecast.
          </p>
        )}
      </section>
    </div>
  )
}

/**
 * Seed likelihood as a sequential ramp — one hue, more-is-darker, never a
 * rainbow. The number is printed beside every bar because colour alone
 * never carries a value on this site.
 */
function SeedDistribution({
  distribution,
}: {
  distribution: Record<string, number>
}) {
  const entries = Object.entries(distribution)
    .map(([seed, p]) => ({ seed: Number(seed), p }))
    .sort((a, b) => a.seed - b.seed)
  const max = Math.max(...entries.map((e) => e.p), 0.01)

  return (
    <div className="space-y-1.5">
      {entries.map(({ seed, p }) => (
        <div key={seed} className="flex items-center gap-3">
          <span className="w-8 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
            #{seed}
          </span>
          <div className="prob-track flex-1">
            <div
              className="h-full"
              style={{
                width: `${(p / max) * 100}%`,
                background: rampStep(p / max),
              }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-numeric text-[11px] text-[var(--text-secondary)]">
            {pct(p, 1)}
          </span>
        </div>
      ))}
      <p className="pt-2 text-[11px] text-[var(--text-tertiary)]">
        Conference seed at the end of the regular season. Seeds 1–6 qualify
        directly; 7–10 enter the play-in.
      </p>
    </div>
  )
}

function rampStep(t: number): string {
  if (t > 0.8) return 'var(--viz-seq-5)'
  if (t > 0.6) return 'var(--viz-seq-4)'
  if (t > 0.4) return 'var(--viz-seq-3)'
  if (t > 0.2) return 'var(--viz-seq-2)'
  return 'var(--viz-seq-1)'
}
