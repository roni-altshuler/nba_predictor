import Link from 'next/link'

import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { LiveSlate } from '@/components/live/LiveSlate'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import {
  getGameForecasts,
  getPowerRatings,
  getSeasonProjections,
  groupByDay,
} from '@/lib/artifacts'
import { dayLabel, pct, stamp } from '@/lib/format'

export const metadata = { title: 'Today' }
export const dynamic = 'force-static'

export default function HomePage() {
  const forecasts = getGameForecasts()
  const projections = getSeasonProjections()
  const ratings = getPowerRatings()

  const days = forecasts ? groupByDay(forecasts.games) : []
  const nextDay = days[0]

  // Projections carry a team_id but no mark; the ratings artifact carries
  // both. Joined here rather than duplicating the logo URL into a second
  // artifact, which would be one more thing to keep in step.
  const brand = new Map((ratings?.teams ?? []).map((t) => [t.team_id, t]))

  return (
    <div>
      <header className="mb-8">
        <p className="eyebrow">Hardwood</p>
        <h1 className="mt-1 text-2xl">Calibrated NBA forecasting</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Game and season probabilities, scored against the closing line. The
          model does not carry market features, so it is measured against the
          market rather than trained on it — and it loses, by a known and
          published margin.
        </p>
      </header>

      {!forecasts ? (
        <EmptyState />
      ) : (
        <>
          <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Season" className="card p-3" valueClassName="mt-1 text-lg">
              {String(forecasts.season)}
            </StatTile>
            <StatTile label="Games forecast" className="card p-3" valueClassName="mt-1 text-lg">
              {forecasts.n_games.toLocaleString()}
            </StatTile>
            <StatTile label="With a line" className="card p-3" valueClassName="mt-1 text-lg">
              {forecasts.n_priced.toLocaleString()}
            </StatTile>
            <StatTile label="Flagged as value" className="card p-3" valueClassName="mt-1 text-lg">
              {forecasts.n_flagged.toLocaleString()}
            </StatTile>
          </section>

          {nextDay ? (
            <section className="mb-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm">Next slate · {dayLabel(nextDay[0])}</h2>
                <Link
                  href="/games"
                  className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)]"
                >
                  All games
                </Link>
              </div>
              {/* A client island, so that on game night the cards overlay
                  the live score ESPN reports — polled in the browser, at
                  zero function cost, on games this server-picked slate
                  already renders. Off nights it renders exactly what the
                  old server-side map did. */}
              <LiveSlate games={nextDay[1].slice(0, 4)} />
            </section>
          ) : null}
        </>
      )}

      {projections ? (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm">Title odds</h2>
            <Link
              href="/season"
              className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)]"
            >
              Full projection
            </Link>
          </div>
          <div className="card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col" className="numeric text-right">Proj. W</th>
                  <th scope="col" className="numeric text-right">Playoffs</th>
                  <th scope="col" className="numeric text-right">Title</th>
                </tr>
              </thead>
              <tbody>
                {projections.teams.slice(0, 8).map((team) => {
                  const mark = brand.get(team.team_id)
                  const cell = (
                    <>
                      <TeamLogo
                        logo={mark?.logo}
                        abbreviation={mark?.abbreviation}
                        name={team.name}
                        size={26}
                      />
                      <span className="font-numeric text-[var(--text-primary)]">
                        {mark?.abbreviation ?? team.name}
                      </span>
                    </>
                  )
                  return (
                  <tr key={team.team_id}>
                    <td>
                      {mark ? (
                        <Link
                          href={`/teams/${mark.abbreviation}`}
                          className="inline-flex items-center gap-2.5 hover:underline"
                        >
                          {cell}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-2.5">
                          {cell}
                        </span>
                      )}
                    </td>
                    <td className="numeric text-right">{team.wins.toFixed(1)}</td>
                    <td className="numeric text-right">{pct(team.p_playoffs, 0)}</td>
                    <td className="numeric text-right text-[var(--text-primary)]">
                      {pct(team.p_championship)}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {ratings ? (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm">Power ratings</h2>
            <Link
              href="/ratings"
              className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)]"
            >
              All 30
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ratings.teams.slice(0, 5).map((team) => (
              <Link
                key={team.team_id}
                href={`/teams/${team.abbreviation}`}
                className="card flex items-center gap-3 p-3"
              >
                <TeamLogo
                  logo={team.logo}
                  abbreviation={team.abbreviation}
                  name={team.name}
                  size={34}
                />
                <div className="min-w-0">
                  <p className="eyebrow">#{team.rank}</p>
                  <p className="numeric truncate text-xs text-[var(--text-primary)]">
                    {team.abbreviation}
                  </p>
                  <p className="numeric text-sm text-[var(--text-secondary)]">
                    {Math.round(team.elo)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <EvidencePanel measured={projections?.measured} />

      {projections ? (
        <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
          model {projections.model_version} · generated {stamp(projections.generated_at)}
        </p>
      ) : null}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card p-6">
      <h2 className="text-sm">No forecast published</h2>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">
        The pipeline has not produced <code>game_forecasts.json</code> yet. Run{' '}
        <code className="font-numeric">
          python3 -m backend.scripts.forecast_season
        </code>{' '}
        to generate it. This page shows nothing rather than showing zeros: an
        absent forecast and a forecast of zero are different facts.
      </p>
    </div>
  )
}
