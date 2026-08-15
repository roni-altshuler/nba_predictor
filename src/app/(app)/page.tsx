import Link from 'next/link'

import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { GameCard } from '@/components/forecast/GameCard'
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
            <Tile label="Season" value={String(forecasts.season)} />
            <Tile label="Games forecast" value={forecasts.n_games.toLocaleString()} />
            <Tile label="With a line" value={forecasts.n_priced.toLocaleString()} />
            <Tile label="Flagged as value" value={forecasts.n_flagged.toLocaleString()} />
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
              <div className="grid gap-3 md:grid-cols-2">
                {nextDay[1].slice(0, 4).map((game) => (
                  <GameCard key={game.game_id} game={game} />
                ))}
              </div>
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
                {projections.teams.slice(0, 8).map((team) => (
                  <tr key={team.team_id}>
                    <td className="text-[var(--text-primary)]">{team.name}</td>
                    <td className="numeric text-right">{team.wins.toFixed(1)}</td>
                    <td className="numeric text-right">{pct(team.p_playoffs, 0)}</td>
                    <td className="numeric text-right text-[var(--text-primary)]">
                      {pct(team.p_championship)}
                    </td>
                  </tr>
                ))}
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
              <div key={team.team_id} className="card p-3">
                <p className="eyebrow">#{team.rank}</p>
                <p className="mt-1 truncate text-xs text-[var(--text-primary)]">
                  {team.abbreviation}
                </p>
                <p className="numeric text-sm text-[var(--text-secondary)]">
                  {Math.round(team.elo)}
                </p>
              </div>
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="eyebrow">{label}</p>
      <p className="numeric mt-1 text-lg text-[var(--text-primary)]">{value}</p>
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
