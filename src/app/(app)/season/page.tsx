import Link from 'next/link'

import { ProjectedFinishChart } from '@/components/charts/ProjectedFinishChart'
import { TitleRaceChart } from '@/components/charts/TitleRaceChart'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getPowerRatings, getSeasonProjections, type TeamProjection } from '@/lib/artifacts'
import { num, pct, stamp } from '@/lib/format'
import {
  getLiveTitleRace,
  getSeasonTitleRace,
  getSeasonsIndex,
} from '@/lib/history'

export const metadata = { title: 'Season projection' }
export const dynamic = 'force-static'

const CONFERENCES = ['Eastern Conference', 'Western Conference'] as const

export default function SeasonPage() {
  const projections = getSeasonProjections()
  const ratings = getPowerRatings()
  const race = getLiveTitleRace()
  const meta = new Map(
    (ratings?.teams ?? []).map((t) => [t.team_id, t]),
  )
  // A live line needs two points, and before opening night there is one.
  // Rather than print an explanation of a chart that is not there, the page
  // shows the most recent completed race, drawn by the same component and
  // labelled a backtest — a worked example beats a description of one.
  const replayable = (getSeasonsIndex()?.seasons ?? [])
    .map((s) => s.season)
    .sort((a, b) => b - a)
    .map((season) => getSeasonTitleRace(season))
    .find(Boolean)
  const liveRace = race && race.checkpoints.length >= 2 ? race : null

  if (!projections) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No projection published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">forecast_season</code> to generate one.
        </p>
      </div>
    )
  }

  const preseason = projections.games_played === 0

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Season {projections.season}</p>
        <h1 className="mt-1 text-2xl">Projected standings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {projections.simulations.toLocaleString()} Monte Carlo seasons.{' '}
          {preseason
            ? 'No games played yet, so every number here comes from ratings alone — regressed toward the mean for the offseason, because the draft and the cap are built to pull teams together.'
            : `${projections.games_played.toLocaleString()} games banked and ${projections.games_remaining.toLocaleString()} to play. Results already recorded seed the simulation, so the projection tightens as the season runs.`}
        </p>
      </header>

      <div className="mb-4 card p-4">
        <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Each simulated season draws <strong className="text-[var(--text-secondary)]">one</strong>{' '}
          strength offset per team and holds it for all 82 games, rather than
          re-rolling every game. Within-season rating drift measured 36.1
          points over 689 team-seasons, and that error is correlated across a
          team&apos;s whole schedule — so no number of simulations averages it
          away. Without it these title odds would be roughly twice as
          confident as any market price.
        </p>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm">Where the season finishes</h2>
          <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            {projections.simulations.toLocaleString()} simulations
          </span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {CONFERENCES.map((conference) => {
            const rows = projections.teams
              .filter((t) => t.conference === conference)
              .map((t) => ({
                abbreviation: meta.get(t.team_id)?.abbreviation ?? t.name,
                name: t.name,
                wins: t.wins,
                low: t.wins_p10,
                high: t.wins_p90,
                p_playoffs: t.p_playoffs,
              }))
            if (rows.length < 2) return null
            return (
              <div key={conference} className="card p-4">
                <h3 className="mb-3 text-xs text-[var(--text-secondary)]">
                  {conference}
                </h3>
                <ProjectedFinishChart rows={rows} label={conference} />
              </div>
            )
          })}
        </div>
      </section>

      {liveRace ? (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm">The title race</h2>
            <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-primary)]">
              Live · published in advance
            </span>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {CONFERENCES.map((conference) => (
              <div key={conference} className="card p-4">
                <h3 className="mb-3 text-xs text-[var(--text-secondary)]">
                  {conference}
                </h3>
                <TitleRaceChart race={liveRace} conference={conference} />
              </div>
            ))}
          </div>
        </section>
      ) : replayable ? (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm">
              How the title race moves · {replayable.season - 1}-
              {String(replayable.season).slice(2)}
            </h2>
            <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-warn)]">
              Backtest
            </span>
          </div>
          <p className="mb-3 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            This season&apos;s live line starts on opening night and gains a
            point every day the forecast runs. Until it has two, the most
            recent completed season is drawn here instead — same chart, same
            model, re-simulated at ten-day checkpoints from ratings that never
            saw the future. It is what this panel becomes.
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            {CONFERENCES.map((conference) => (
              <div key={conference} className="card p-4">
                <h3 className="mb-3 text-xs text-[var(--text-secondary)]">
                  {conference}
                </h3>
                <TitleRaceChart race={replayable} conference={conference} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
            <Link
              href={`/seasons/${replayable.season}`}
              className="text-[var(--accent-info)] hover:underline"
            >
              The full {replayable.season - 1}-
              {String(replayable.season).slice(2)} season
            </Link>{' '}
            — standings, bracket and every result.
          </p>
        </section>
      ) : null}

      {CONFERENCES.map((conference) => {
        const members = projections.teams
          .filter((t) => t.conference === conference)
          .sort((a, b) => b.wins - a.wins)
        if (!members.length) return null
        return (
          <section key={conference} className="mb-8">
            <h2 className="mb-3 text-sm">{conference}</h2>
            <div className="card overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Team</th>
                    <th scope="col" className="numeric text-right">Proj. W-L</th>
                    <th scope="col" className="numeric text-right">Range</th>
                    <th scope="col" className="numeric text-right">Playoffs</th>
                    <th scope="col" className="numeric text-right">Play-in</th>
                    <th scope="col" className="numeric text-right">Conf.</th>
                    <th scope="col" className="numeric text-right">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((team, index) => (
                    <Row
                      key={team.team_id}
                      team={team}
                      rank={index + 1}
                      logo={meta.get(team.team_id)?.logo}
                      abbreviation={meta.get(team.team_id)?.abbreviation}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <EvidencePanel measured={projections.measured} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {projections.model_version} · generated {stamp(projections.generated_at)}
      </p>
    </div>
  )
}

function Row({
  team,
  rank,
  logo,
  abbreviation,
}: {
  team: TeamProjection
  rank: number
  logo?: string | null
  abbreviation?: string
}) {
  // Colour carries meaning only: the direct-playoff cut at 6 and the play-in
  // band at 10 are the two lines that decide a team's season.
  const tone =
    rank <= 6
      ? 'text-[var(--accent-primary)]'
      : rank <= 10
        ? 'text-[var(--accent-warn)]'
        : 'text-[var(--text-tertiary)]'

  return (
    <tr>
      <td className={`numeric ${tone}`}>{rank}</td>
      <td>
        {abbreviation ? (
          <Link
            href={`/teams/${abbreviation}`}
            className="text-[var(--text-primary)] hover:underline"
          >
            <TeamLabel logo={logo} abbreviation={abbreviation} name={team.name} />
          </Link>
        ) : (
          <span className="text-[var(--text-primary)]">{team.name}</span>
        )}
      </td>
      <td className="numeric text-right">
        {team.wins.toFixed(1)}–{team.losses.toFixed(1)}
      </td>
      <td className="numeric text-right text-[var(--text-tertiary)]">
        {num(team.wins_p10, 0)}–{num(team.wins_p90, 0)}
      </td>
      <td className="numeric text-right">{pct(team.p_playoffs, 0)}</td>
      <td className="numeric text-right text-[var(--text-tertiary)]">
        {pct(team.p_play_in, 0)}
      </td>
      <td className="numeric text-right">{pct(team.p_conference_title)}</td>
      <td className="numeric text-right text-[var(--text-primary)]">
        {pct(team.p_championship)}
      </td>
    </tr>
  )
}
