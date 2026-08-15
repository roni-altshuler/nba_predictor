import Link from 'next/link'

import { TitleRaceChart } from '@/components/charts/TitleRaceChart'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getPowerRatings, getSeasonProjections, type TeamProjection } from '@/lib/artifacts'
import { num, pct, stamp } from '@/lib/format'
import { getLiveTitleRace, getSeasonsIndex } from '@/lib/history'

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
  // The most recent season the archive can replay, offered while the live
  // line is still a single point. A worked example of what this chart
  // becomes beats an explanation of it.
  const replayable = (getSeasonsIndex()?.seasons ?? [])
    .map((s) => s.season)
    .sort((a, b) => b - a)[0]

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

      {race ? (
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
                <TitleRaceChart race={race} conference={conference} />
              </div>
            ))}
          </div>
          {race.checkpoints.length < 2 && replayable ? (
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              To see what this becomes over a full season, the archive replays
              a completed one the same way —{' '}
              <Link
                href={`/seasons/${replayable}`}
                className="text-[var(--accent-info)] hover:underline"
              >
                the {replayable - 1}-{String(replayable).slice(2)} race
              </Link>
              , reconstructed at ten-day checkpoints.
            </p>
          ) : null}
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
