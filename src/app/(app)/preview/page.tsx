import Link from 'next/link'

import { getGameForecasts, getSeasonProjections } from '@/lib/artifacts'
import { getSeason, getSeasonTitleRace, getSeasonsIndex } from '@/lib/history'
import { gameDate, num, pct } from '@/lib/format'

export const metadata = { title: 'Season preview' }
export const dynamic = 'force-static'

/**
 * The preseason page: what the model thinks before a ball is bounced.
 *
 * **It exists because the offseason is four months long and this site had
 * nothing to say during it.** Between the Finals and opening night the home
 * page is a slate with no games on it — and the projection, which is the most
 * interesting thing this product does, sits one click away on a page built
 * for a season in progress.
 *
 * The load-bearing section is the last one. A preseason projection is the
 * most confident and least tested thing a forecaster produces, so this page
 * prints the previous season's opening-day projection beside what actually
 * happened, from the archived replay. It is the cheapest honest accountability
 * available: the numbers are already computed, they were wrong in a specific
 * and interesting way, and showing them costs nothing except the temptation
 * to look clever in August.
 */
export default function PreviewPage() {
  const projections = getSeasonProjections()
  const forecasts = getGameForecasts()
  const index = getSeasonsIndex()

  if (!projections) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No projection published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">forecast_season</code>.
        </p>
      </div>
    )
  }

  const season = projections.season
  const previous = season - 1
  const last = getSeason(previous)
  // Keyed on the franchise's display name: both sides read it from the same
  // `teams` table, and the projection artifact does not carry an
  // abbreviation. Matching on a field only one side publishes would silently
  // drop every row.
  const lastWins = new Map(
    (last?.standings ?? []).map((row) => [row.name, row.wins]),
  )
  const label = `${season - 1}-${String(season).slice(2)}`

  const teams = [...projections.teams].sort((a, b) => b.wins - a.wins)
  const contenders = [...projections.teams]
    .sort((a, b) => b.p_championship - a.p_championship)
    .slice(0, 8)

  // Biggest projected swings against last season's real record. The model
  // has no roster information at all, so every one of these is Elo
  // regression and schedule — which is worth saying out loud beside them.
  const movers = teams
    .map((team) => {
      const before = lastWins.get(team.name)
      return { team, before, delta: before === undefined ? null : team.wins - before }
    })
    .filter((row) => row.delta !== null)
    .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number))
    .slice(0, 10)

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Preseason</p>
        <h1 className="mt-1 text-2xl">{label}, before it starts</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {projections.simulations.toLocaleString()} simulated seasons from
          ratings regressed at the offseason boundary.{' '}
          {forecasts?.season_start ? (
            <>
              First tip-off{' '}
              <span className="font-numeric text-[var(--text-primary)]">
                {gameDate(forecasts.season_start)}
              </span>
              .
            </>
          ) : null}
        </p>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
          <strong className="text-[var(--text-secondary)]">
            The model does not know who is on any of these teams.
          </strong>{' '}
          It has never read a trade, a draft or an injury report. In October
          that is at its most costly — every roster has changed and nothing
          below reflects it, which is why these title odds are more
          concentrated than a real futures market&rsquo;s and why the gap
          narrows as games are actually played.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm">Who wins it</h2>
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col" className="numeric text-right">Projected</th>
                <th scope="col" className="numeric text-right">Playoffs</th>
                <th scope="col" className="numeric text-right">Conference</th>
                <th scope="col" className="numeric text-right">Title</th>
              </tr>
            </thead>
            <tbody>
              {contenders.map((team) => (
                <tr key={team.team_id}>
                  <td className="text-[var(--text-primary)]">{team.name}</td>
                  <td className="numeric text-right">
                    {num(team.wins, 1)}&ndash;{num(team.losses, 1)}
                  </td>
                  <td className="numeric text-right">{pct(team.p_playoffs, 0)}</td>
                  <td className="numeric text-right">
                    {pct(team.p_conference_title, 1)}
                  </td>
                  <td className="numeric text-right text-[var(--text-primary)]">
                    {pct(team.p_championship, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
          The full thirty, the seed distributions and the projected bracket
          are on <Link href="/season" className="underline underline-offset-4">the season page</Link>{' '}
          and <Link href="/bracket" className="underline underline-offset-4">the bracket</Link>.
        </p>
      </section>

      {movers.length ? (
        <section className="mb-10">
          <h2 className="mb-1 text-sm">Biggest projected swings</h2>
          <p className="mb-3 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
            Against what each team actually won in {previous - 1}-
            {String(previous).slice(2)}. Every one of these is regression to
            the mean and a different schedule — not an opinion about a signing,
            because the model has not heard about any signings.
          </p>
          <div className="card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col" className="numeric text-right">Last season</th>
                  <th scope="col" className="numeric text-right">Projected</th>
                  <th scope="col" className="numeric text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {movers.map(({ team, before, delta }) => (
                  <tr key={team.team_id}>
                    <td className="text-[var(--text-primary)]">{team.name}</td>
                    <td className="numeric text-right">{before}</td>
                    <td className="numeric text-right">{num(team.wins, 1)}</td>
                    <td
                      className={`numeric text-right ${
                        (delta as number) > 0
                          ? 'text-[var(--accent-good)]'
                          : 'text-[var(--accent-warn)]'
                      }`}
                    >
                      {(delta as number) > 0 ? '+' : ''}
                      {num(delta, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <LastYear season={previous} champion={
        index?.seasons.find((s) => s.season === previous)?.champion ?? null
      } />
    </div>
  )
}

/**
 * What this projection was worth a year ago.
 *
 * Read from the archived title-race replay, whose first checkpoint is the
 * day of the previous season's opener with zero games played — which is
 * exactly the same object as the table above it, one season earlier.
 *
 * **It is a backtest and is labelled one**, and its epistemic status is the
 * weaker of the two things on this page: the replay reconstructs what the
 * model would have said, not what it did say. That is stated rather than
 * glossed. It is still the most useful thing on the page, because it is the
 * only part a reader can check.
 */
function LastYear({
  season,
  champion,
}: {
  season: number
  champion: string | null
}) {
  const race = getSeasonTitleRace(season)
  const opening = race?.checkpoints?.[0]
  if (!race || !opening || opening.games_played > 0) return null

  const ranked = Object.entries(opening.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const championProbability = champion
    ? opening.probabilities[champion]
    : undefined

  return (
    <section className="mb-10 border-t border-[var(--border-color)] pt-8">
      <p className="eyebrow">Accountability</p>
      <h2 className="mt-1 text-lg">
        What it thought this time last year
      </h2>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
        The same projection, one season earlier, on the morning of the opener
        with no games played. Conference-title probability.
      </p>

      <div className="card mt-4 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Conference</th>
              <th scope="col" className="numeric text-right">
                Conference title, opening day
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(([team, probability]) => (
              <tr key={team}>
                <td
                  className={
                    team === champion ? 'text-[var(--text-primary)]' : ''
                  }
                >
                  {race.teams[team]?.name ?? team}
                  {team === champion ? (
                    <span className="ml-2 text-[10px] uppercase tracking-[0.1em] text-[var(--accent-warn)]">
                      won the title
                    </span>
                  ) : null}
                </td>
                {/* Named because the list is ranked across both. Each
                    number is P(win your OWN conference), so two rows here are
                    not competing for the same thing. */}
                <td className="text-[var(--text-tertiary)]">
                  {race.teams[team]?.conference?.replace(' Conference', '') ?? '—'}
                </td>
                <td className="numeric text-right">{pct(probability, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {champion && championProbability !== undefined ? (
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            {race.teams[champion]?.name ?? champion} went on to win it, from{' '}
            {pct(championProbability, 1)}
          </strong>{' '}
          — outside the top three on their own side of the bracket. That is
          not a defect in the projection so much as a fact about the sport:
          eight teams a conference reach the postseason and the favourite is
          rarely above a third. It is worth reading beside the table at the
          top of this page.
        </p>
      ) : null}

      <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        <strong className="text-[var(--accent-warn)]">Backtest.</strong> The
        replay reconstructs what the model would have said from ratings built
        on games strictly earlier than each checkpoint. Nobody read these
        numbers on that morning. The live record, which is a different and
        stronger claim, is on{' '}
        <Link href="/accuracy" className="underline underline-offset-4">
          the record page
        </Link>
        , and it starts at zero.{' '}
        <Link
          href={`/seasons/${season}`}
          className="underline underline-offset-4"
        >
          The whole {season - 1}-{String(season).slice(2)} race
        </Link>{' '}
        is in the archive.
      </p>
    </section>
  )
}
