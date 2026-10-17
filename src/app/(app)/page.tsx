import Link from 'next/link'

import { BarLadder, type BarLadderRow } from '@/components/charts/BarLadder'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { LiveSlate } from '@/components/live/LiveSlate'
import { RecentGames } from '@/components/players/RecentGames'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamExplorer, type ExplorerRow } from '@/components/teams/TeamExplorer'
import {
  getGameForecasts,
  getLiveRecord,
  getPowerRatings,
  getSeasonProjections,
  groupByDay,
} from '@/lib/artifacts'
import { dayLabel, pct, stamp } from '@/lib/format'
import { getGameContext } from '@/lib/history'

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
  const liveRecord = getLiveRecord()
  const preseason = !!forecasts?.season_start && Date.parse(forecasts.generated_at) < Date.parse(forecasts.season_start)

  // Projections carry a team_id but no mark; the ratings artifact carries
  // both. Joined here rather than duplicating the logo URL into a second
  // artifact, which would be one more thing to keep in step.
  const brand = new Map((ratings?.teams ?? []).map((t) => [t.team_id, t]))

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
      <header className="mb-5">
        <p className="eyebrow">{forecasts ? `${forecasts.season - 1}–${String(forecasts.season).slice(2)} regular season` : 'Hardwood'}</p>
        <h1 className="mt-1 text-2xl">NBA games &amp; scores</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Explore the matchups, find your team, and get closer to the game.</p>
        <nav aria-label="Explore Hardwood" className="mt-4 grid grid-cols-3 gap-2 sm:flex">
          {[['#home-games', 'Games'], [explorer.length ? '#home-teams' : '/season', 'Teams'], ['#home-players', 'Players']].map(([href, label]) => <Link key={href} href={href} prefetch={false} className="inline-flex min-h-[44px] items-center justify-center rounded-sm border border-[var(--border-color)] bg-[var(--card-bg)] px-5 font-numeric text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)]">{label}</Link>)}
        </nav>
      </header>

      {nextDay ? <section id="home-games" aria-labelledby="home-games-title" className="mb-6 scroll-mt-20">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="home-games-title" className="text-sm">Next games · {dayLabel(nextDay[0])}</h2>
          <Link href={`/games?date=${nextDay[0]}`} className={`${sectionLink} inline-flex min-h-[44px] items-center underline underline-offset-4`}>Daily slate →</Link>
        </div>
        <nav aria-label="Published game dates" className="mb-3 flex flex-wrap gap-2">
          {days.slice(0, 4).map(([day]) => {
            const date = new Date(`${day}T12:00:00Z`)
            const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
            const number = Number(day.slice(-2))
            const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
            return <Link key={day} href={`/games?date=${day}`} aria-label={`${weekday} ${number}, ${monthYear}`} prefetch={false} className={`inline-flex min-h-[58px] min-w-[62px] flex-col items-center justify-center rounded-sm border px-3 font-numeric text-[11px] ${day === nextDay[0] ? 'border-[var(--accent-brand)] text-[var(--text-primary)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'}`}><span>{weekday}</span>{' '}<span className="numeric mt-1 text-base">{number}</span></Link>
          })}
        </nav>
        <LiveSlate games={nextDay[1]} compact />
        <details className="mt-2 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)]">
          <summary className="min-h-[44px] cursor-pointer py-3 font-numeric">Forecast timing &amp; coverage</summary>
        {forecasts ? <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          {forecasts.season - 1}–{String(forecasts.season).slice(2)} regular season{preseason ? ' · preseason publication' : ''}.
          {' '}Preseason exhibition forecasts are unavailable here.
          {liveRecord?.season === forecasts.season && liveRecord.n === 0 ? ' No settled regular-season forecasts yet.' : ''}
        </p> : null}
          <p className="pb-2 leading-relaxed">Published {stamp(forecasts!.generated_at)} · results used through {stamp(forecasts!.trained_through ?? undefined)}.
            {' '}Published regular-season coverage only; confirmed live/final scores use the existing score feed. An unavailable score is never a zero. <Link href="/accuracy" className="text-[var(--accent-info)] underline underline-offset-4">Model record</Link>.</p>
        </details>
      </section> : <EmptyState />}

      <RecentGames context={getGameContext()} teams={rated} />

      {explorer.length ? (
        <section id="home-teams" className="mb-8 scroll-mt-20">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm">Teams</h2>
            <span className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              {projections ? 'projected record' : 'elo'}
            </span>
          </div>
          <TeamExplorer rows={explorer} />
        </section>
      ) : null}

      <details id="home-season-outlook" className="border-t border-[var(--border-color)]">
        <summary className="min-h-[44px] cursor-pointer py-3 font-numeric text-sm text-[var(--text-secondary)]">Season outlook &amp; model evidence</summary>
        <div className="pt-3">
          {forecasts ? <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          </section> : null}
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

          <EvidencePanel measured={projections?.measured} />
        </div>
      </details>
    </div>
  )
}

function EmptyState() {
  return <section id="home-games" className="card mb-6 scroll-mt-20 p-4" aria-labelledby="home-unavailable">
    <h2 id="home-unavailable" className="text-sm">Published schedule unavailable</h2>
    <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">No games are available in this publication. This does not mean a zero win chance or a completed game.</p>
    <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--accent-info)]">
      <Link href="/games" className="inline-flex min-h-[44px] items-center underline underline-offset-4">Browse daily slates →</Link>
      <Link href="/seasons" className="inline-flex min-h-[44px] items-center underline underline-offset-4">Completed seasons →</Link>
    </div>
  </section>
}
