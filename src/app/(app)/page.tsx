import Link from 'next/link'

import { BarLadder, type BarLadderRow } from '@/components/charts/BarLadder'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { QuickPicks } from '@/components/forecast/QuickPicks'
import { LiveSlate } from '@/components/live/LiveSlate'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamExplorer, type ExplorerRow } from '@/components/teams/TeamExplorer'
import {
  getGameForecasts,
  getPowerRatings,
  getSeasonProjections,
  groupByDay,
} from '@/lib/artifacts'
import { dayLabel, pct, stamp } from '@/lib/format'

export const metadata = { title: 'Today' }
export const dynamic = 'force-static'

const sectionLink =
  'font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)]'

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
  const provenance = projections ?? forecasts

  // Title odds: the eight likeliest champions. Bars are a share of the
  // leader so the list has resolution; the number beside each is the claim.
  const contenders = projections
    ? [...projections.teams]
        .sort((a, b) => b.p_championship - a.p_championship)
        .slice(0, 8)
    : []
  const topOdds = contenders[0]?.p_championship || 1
  const oddsRows: BarLadderRow[] = contenders.map((team) => {
    const mark = brand.get(team.team_id)
    return {
      key: String(team.team_id),
      href: mark ? `/teams/${mark.abbreviation}` : undefined,
      logo: mark?.logo,
      abbreviation: mark?.abbreviation,
      name: team.name,
      label: mark?.abbreviation ?? team.name,
      caption: `${team.wins.toFixed(1)} W · ${pct(team.p_playoffs, 0)} playoffs`,
      fill: team.p_championship / topOdds,
      value: pct(team.p_championship),
    }
  })

  // Power ratings: bars span the PUBLISHED best-to-worst of all 30, so the
  // top-eight ladder reads on the same scale as the full table.
  const rated = ratings?.teams ?? []
  const best = rated[0]?.elo ?? 1500
  const worst = rated[rated.length - 1]?.elo ?? 1500
  const span = Math.max(best - worst, 1)
  const ratingRows: BarLadderRow[] = rated.slice(0, 8).map((team) => ({
    key: String(team.team_id),
    href: `/teams/${team.abbreviation}`,
    logo: team.logo,
    abbreviation: team.abbreviation,
    name: team.name,
    label: team.abbreviation,
    caption: team.conference?.replace(' Conference', ''),
    fill: (team.elo - worst) / span,
    value: String(Math.round(team.elo)),
    rank: team.rank,
  }))

  // The explorer: every franchise, captioned with its projected record when
  // the projection exists and its rating otherwise. The heading says which.
  const projectionById = new Map((projections?.teams ?? []).map((t) => [t.team_id, t]))
  const explorer: ExplorerRow[] = rated.map((team) => {
    const projection = projectionById.get(team.team_id)
    return {
      team,
      caption: projection
        ? `${projection.wins.toFixed(0)}–${projection.losses.toFixed(0)}`
        : String(Math.round(team.elo)),
    }
  })

  return (
    <div>
      <header className="mb-8">
        <p className="eyebrow">Hardwood</p>
        <h1 className="mt-1 text-2xl">Calibrated NBA forecasting</h1>
        {provenance ? (
          <p className="mt-2 font-numeric text-[11px] text-[var(--text-tertiary)]">
            model {provenance.model_version} · generated{' '}
            {stamp(provenance.generated_at)} · scored against the closing line
          </p>
        ) : null}
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
                <Link href="/games" className={sectionLink}>
                  All games
                </Link>
              </div>
              {/* A client island, so that on game night the cards overlay
                  the live score ESPN reports — polled in the browser, at
                  zero function cost, on games this server-picked slate
                  already renders. Off nights it renders exactly what the
                  old server-side map did. */}
              <LiveSlate games={nextDay[1].slice(0, 4)} />
              {/* Every game on the slate, not just the four cards, as a
                  jump into the head-to-head surface. */}
              <QuickPicks games={nextDay[1]} className="mt-4" />
            </section>
          ) : null}
        </>
      )}

      {oddsRows.length ? (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm">Title odds</h2>
            <Link href="/season" className={sectionLink}>
              Full projection
            </Link>
          </div>
          <BarLadder rows={oddsRows} ariaLabel="Championship odds, top eight" />
        </section>
      ) : null}

      {ratingRows.length ? (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm">Power ratings</h2>
            <Link href="/ratings" className={sectionLink}>
              All 30
            </Link>
          </div>
          <BarLadder rows={ratingRows} ariaLabel="Power ratings, top eight" />
        </section>
      ) : null}

      {explorer.length ? (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm">Teams</h2>
            <span className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {projections ? 'projected record' : 'elo'}
            </span>
          </div>
          <TeamExplorer rows={explorer} />
        </section>
      ) : null}

      <EvidencePanel measured={projections?.measured} />
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
