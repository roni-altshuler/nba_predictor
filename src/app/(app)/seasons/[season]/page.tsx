import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TitleRaceChart } from '@/components/charts/TitleRaceChart'
import { PlayoffBracket } from '@/components/playoffs/PlayoffBracket'
import { BackLink } from '@/components/primitives/BackLink'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamLabel } from '@/components/primitives/TeamLogo'
import { num, pct } from '@/lib/format'
import {
  SEASON_TYPE_LABEL,
  getSeason,
  getSeasonTitleRace,
  getSeasonsIndex,
  teamMetaFromStandings,
  type StandingRow,
} from '@/lib/history'

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
  return { title: `${value - 1}-${String(value).slice(2)} season` }
}

const CONFERENCES = ['Eastern Conference', 'Western Conference'] as const

export default async function SeasonPage({
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
  const resolvedSeries = file.series.filter((s) => s.team_a && s.team_b)
  const race = getSeasonTitleRace(value)

  // A handful of the season's most lopsided results — the games a reader
  // remembers, and the ones the model got most wrong.
  const scored = file.games.filter((g) => g.p_model !== undefined)
  const upsets = [...scored]
    .map((g) => {
      const homeWon = g.home_score > g.away_score
      const said = homeWon ? g.p_model! : 1 - g.p_model!
      return { game: g, said }
    })
    .sort((a, b) => a.said - b.said)
    .slice(0, 5)

  return (
    <div>
      <header className="mb-6">
        <BackLink href="/seasons" label="All seasons" />
        <h1 className="mt-2 text-2xl">{label} season</h1>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {file.games.length.toLocaleString()} games
          {file.champion ? (
            <>
              {' · '}
              <span className="text-[var(--accent-warn)]">
                {teams[file.champion]?.name ?? file.champion} won the title
              </span>
            </>
          ) : null}
        </p>
      </header>

      {file.accuracy ? <AccuracyStrip accuracy={file.accuracy} /> : null}

      {CONFERENCES.map((conference) => {
        const members = file.standings.filter((t) => t.conference === conference)
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
                    <th scope="col" className="numeric text-right">W</th>
                    <th scope="col" className="numeric text-right">L</th>
                    <th scope="col" className="numeric text-right">PCT</th>
                    <th scope="col" className="numeric text-right">Home</th>
                    <th scope="col" className="numeric text-right">Away</th>
                    <th scope="col" className="numeric text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((team) => (
                    <Row key={team.team_id} team={team} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {race ? (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm">How the title race moved</h2>
            <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-warn)]">
              Backtest
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
        </section>
      ) : null}

      {resolvedSeries.length ? (
        <div className="mb-8">
          <PlayoffBracket
            series={resolvedSeries}
            teams={teams}
            season={value}
          />
        </div>
      ) : null}

      {upsets.length ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm">The model&apos;s five biggest misses</h2>
          <div className="card divide-y divide-[var(--border-color)]">
            {upsets.map(({ game, said }) => (
              <Link
                key={game.id}
                href={`/games/${game.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
              >
                <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
                  {new Date(game.date).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', timeZone: 'America/New_York',
                  })}
                </span>
                <span className="text-sm text-[var(--text-primary)]">
                  {game.away} {game.away_score} @ {game.home} {game.home_score}
                </span>
                <span className="ml-auto font-numeric text-xs text-[var(--accent-loss)]">
                  gave the winner {pct(said, 1)}
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            These are the honest low points, printed with the same prominence
            the hits get. A record that only shows its wins is an
            advertisement.
          </p>
        </section>
      ) : null}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm">Results</h2>
          <Link
            href={`/seasons/${value}/games`}
            className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)]"
          >
            Browse all {file.games.length.toLocaleString()} games
          </Link>
        </div>
        <div className="card divide-y divide-[var(--border-color)]">
          {file.games.slice(-8).reverse().map((game) => (
            <Link
              key={game.id}
              href={`/games/${game.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 transition-colors hover:bg-[var(--card-hover)]"
            >
              <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
                {new Date(game.date).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', timeZone: 'America/New_York',
                })}
              </span>
              <span className="text-sm text-[var(--text-primary)]">
                {game.away} {game.away_score} @ {game.home} {game.home_score}
              </span>
              {game.phase ? (
                <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
                  {game.phase}
                </span>
              ) : null}
              <span className="ml-auto font-numeric text-[11px] text-[var(--text-tertiary)]">
                {SEASON_TYPE_LABEL[game.type] ?? ''}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function Row({ team }: { team: StandingRow }) {
  const rank = team.conference_rank ?? 0
  const tone =
    rank <= 6
      ? 'text-[var(--accent-primary)]'
      : rank <= 10
        ? 'text-[var(--accent-warn)]'
        : 'text-[var(--text-tertiary)]'
  return (
    <tr>
      <td className={`numeric ${tone}`}>{rank || '—'}</td>
      <td>
        <Link
          href={`/teams/${team.abbreviation}`}
          className="text-[var(--text-primary)] hover:underline"
        >
          <TeamLabel
            logo={team.logo}
            abbreviation={team.abbreviation}
            name={team.name}
          />
        </Link>
      </td>
      <td className="numeric text-right">{team.wins}</td>
      <td className="numeric text-right">{team.losses}</td>
      <td className="numeric text-right">{team.win_pct.toFixed(3).slice(1)}</td>
      <td className="numeric text-right text-[var(--text-tertiary)]">
        {team.home_wins}–{team.home_losses}
      </td>
      <td className="numeric text-right text-[var(--text-tertiary)]">
        {team.away_wins}–{team.away_losses}
      </td>
      <td
        className={`numeric text-right ${
          team.net_rating >= 0
            ? 'text-[var(--accent-primary)]'
            : 'text-[var(--accent-loss)]'
        }`}
      >
        {team.net_rating > 0 ? '+' : ''}
        {team.net_rating.toFixed(1)}
      </td>
    </tr>
  )
}

function AccuracyStrip({ accuracy }: { accuracy: Record<string, any> }) {
  const market = accuracy.market as Record<string, number> | undefined
  const paired = accuracy.paired_model as Record<string, number> | undefined
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        label="Games scored"
        className="card p-3"
        valueClassName="mt-1 text-lg"
      >
        {(accuracy.n as number)?.toLocaleString() ?? '—'}
      </StatTile>
      <StatTile
        label="Model Brier"
        className="card p-3"
        valueClassName="mt-1 text-lg"
      >
        {num(accuracy.brier as number, 4)}
      </StatTile>
      <StatTile
        label="Market Brier"
        className="card p-3"
        valueClassName="mt-1 text-lg"
      >
        {market ? num(market.brier, 4) : 'no line'}
      </StatTile>
      <StatTile
        label="Gap to close"
        className="card p-3"
        valueClassName="mt-1 text-lg"
      >
        {market && paired ? `+${num(paired.brier - market.brier, 4)}` : '—'}
      </StatTile>
    </div>
  )
}
