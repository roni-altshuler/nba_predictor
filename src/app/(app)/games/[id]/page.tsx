import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { getGameForecasts } from '@/lib/artifacts'
import { getEspnBoxScore, type GameBoxScore, type TeamBoxScore } from '@/lib/espn'
import { gameTime, moneyline, num, pct, signed, spread } from '@/lib/format'
import {
  SEASON_TYPE_LABEL,
  formFor,
  getAllStarEvent,
  getArchivedGame,
  getGameContext,
  meetingsBetween,
  teamMetaFromStandings,
  type AllStarEvent,
  type ArchiveGame,
  type Meeting,
} from '@/lib/history'
import { cn } from '@/lib/utils'

export const dynamic = 'force-static'
// 31,844 archived games is far too many to prerender, and prerendering only
// some would 404 the rest. The route renders on demand and caches.
export const dynamicParams = true
// Player lines come from ESPN at request time rather than from the
// warehouse; a day is long enough that a box score is final and short
// enough that a game finishing tonight is complete tomorrow.
export const revalidate = 86_400

export function generateStaticParams() {
  // Prerender only the upcoming slate — the pages anyone is actually
  // browsing before the season starts. Everything else renders on request.
  const forecasts = getGameForecasts()
  return (forecasts?.games ?? []).slice(0, 60).map((g) => ({ id: g.game_id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const archived = getArchivedGame(id)
  if (archived) {
    const { game } = archived
    return {
      title: `${game.away} ${game.away_score} – ${game.home_score} ${game.home}`,
    }
  }
  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) {
    return { title: `${upcoming.away.abbreviation} at ${upcoming.home.abbreviation}` }
  }
  return { title: 'Game' }
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const archived = getArchivedGame(id)
  if (archived) {
    // Only played games have player lines, so the network call is scoped to
    // the branch that can use it — an upcoming fixture would spend a request
    // to learn that nobody has played yet.
    const box = await getEspnBoxScore(id)
    return (
      <PlayedGame
        game={archived.game}
        standings={archived.season.standings}
        box={box}
      />
    )
  }

  // All-Star games are not in the season archive: their sides carry no
  // conference, so every franchise filter in the pipeline drops them. They
  // are published separately and looked up here.
  const allStar = getAllStarEvent(id)
  if (allStar) {
    const box = await getEspnBoxScore(id)
    return <AllStarGame event={allStar} box={box} />
  }

  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) return <UpcomingGame game={upcoming} />

  notFound()
}

/* -------------------------------------------------------------- all-star */

/**
 * An All-Star game: the result, the periods and the box score — and no
 * forecast, because there is not one and inventing one would be a category
 * error rather than a feature.
 */
function AllStarGame({
  event,
  box,
}: {
  event: AllStarEvent
  box: GameBoxScore | null
}) {
  const homeWon = event.home_score > event.away_score
  return (
    <div>
      <header className="mb-6">
        <Link
          href="/allstar"
          className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ← All-Star weekend
        </Link>
        <p className="eyebrow mt-3">
          {event.label} · {event.season - 1}-{String(event.season).slice(2)}
        </p>

        <div className="mt-3 flex items-center justify-between gap-4">
          <ScoreSide
            team={event.away.abbreviation ?? event.away.name}
            meta={event.away}
            score={event.away_score}
            won={!homeWon}
          />
          <span className="font-numeric text-xs text-[var(--text-tertiary)]">
            final
          </span>
          <ScoreSide
            team={event.home.abbreviation ?? event.home.name}
            meta={event.home}
            score={event.home_score}
            won={homeWon}
            align="right"
          />
        </div>

        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          {new Date(event.date).toLocaleString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            timeZone: 'America/New_York',
          })}
          {event.venue ? ` · ${event.venue}` : ''}
        </p>
      </header>

      {event.q_home && event.q_away ? (
        <div className="mb-6">
          <PeriodTable
            awayLabel={event.away.abbreviation ?? event.away.name}
            homeLabel={event.home.abbreviation ?? event.home.name}
            qAway={event.q_away}
            qHome={event.q_home}
            ot={0}
            awayTotal={event.away_score}
            homeTotal={event.home_score}
          />
        </div>
      ) : (
        <section className="card mb-6 p-4">
          <h2 className="text-sm">No period breakdown</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            This format was not played in quarters — since 2024 the All-Star
            Game has been an untimed race to a target score — so the source
            publishes no period scores. Shown as absent rather than as four
            zeros.
          </p>
        </section>
      )}

      <section className="card mb-6 p-4">
        <h2 className="text-sm">No forecast</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Deliberately. The sides were drafted the week before and exist for
          one night, and the ratings this model carries describe 82-game
          franchises. A probability here would be a number with nothing behind
          it. The raw source label was{' '}
          <code className="font-numeric">{event.phase}</code>.
        </p>
      </section>

      {box ? (
        <PlayerBoxScores box={box} />
      ) : (
        <section className="card p-4">
          <h2 className="text-sm">No player box score</h2>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            Player lines are read from ESPN when this page is built, and the
            request did not come back.
          </p>
        </section>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- played */

function PlayedGame({
  game,
  standings,
  box,
}: {
  game: ArchiveGame
  standings: Parameters<typeof teamMetaFromStandings>[0]
  box: GameBoxScore | null
}) {
  const teams = teamMetaFromStandings(standings)
  const homeWon = game.home_score > game.away_score
  const margin = Math.abs(game.home_score - game.away_score)

  return (
    <div>
      <header className="mb-6">
        <Link
          href={`/seasons/${game.season}`}
          className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ← {game.season - 1}-{String(game.season).slice(2)} season
        </Link>
        <p className="eyebrow mt-3">
          {SEASON_TYPE_LABEL[game.type] ?? ''}
          {game.phase ? ` · ${game.phase}` : ''}
          {game.ot > 0 ? ` · ${game.ot === 1 ? 'OT' : `${game.ot}OT`}` : ''}
        </p>

        <div className="mt-3 flex items-center justify-between gap-4">
          <ScoreSide
            team={game.away}
            meta={teams[game.away]}
            score={game.away_score}
            won={!homeWon}
          />
          <span className="font-numeric text-xs text-[var(--text-tertiary)]">
            final
          </span>
          <ScoreSide
            team={game.home}
            meta={teams[game.home]}
            score={game.home_score}
            won={homeWon}
            align="right"
          />
        </div>

        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          {new Date(game.date).toLocaleString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            timeZone: 'America/New_York',
          })}
          {game.venue ? ` · ${game.venue}` : ''}
          {game.neutral ? ' · neutral court' : ''}
        </p>
      </header>

      {game.q_home && game.q_away ? (
        <div className="mb-6">
          <PeriodTable
            awayLabel={game.away}
            homeLabel={game.home}
            qAway={game.q_away}
            qHome={game.q_home}
            ot={game.ot}
            awayTotal={game.away_score}
            homeTotal={game.home_score}
          />
        </div>
      ) : (
        <section className="card mb-6 p-4">
          <h2 className="text-sm">No period breakdown</h2>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            The source published no quarter scores for this game. Shown as
            absent rather than as four zeros.
          </p>
        </section>
      )}

      {game.p_model !== undefined ? (
        <RecordedForecast game={game} homeWon={homeWon} margin={margin} />
      ) : (
        <section className="card mb-6 p-4">
          <h2 className="text-sm">No forecast for this game</h2>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            It falls inside the warm-up seasons the model was fitted on, so
            there is no out-of-sample forecast to show. Reconstructing one now
            would be a model that had seen the answer.
          </p>
        </section>
      )}

      {box ? (
        <>
          <TeamComparison box={box} />
          <PlayerBoxScores box={box} />
        </>
      ) : (
        <>
          <section className="card mb-6 p-4">
            <h2 className="text-sm">No player box score</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Player lines are read from ESPN when this page is built, not
              stored here, and the request did not come back. The result,
              periods and forecast above are ours and are unaffected.
            </p>
          </section>
          {game.box_home && game.box_away ? (
            <div className="mb-6">
              <BoxScore game={game} />
            </div>
          ) : null}
        </>
      )}

      <SeriesHistory away={game.away} home={game.home} excludeId={game.id} />
    </div>
  )
}

/* ---------------------------------------------------------- player lines */

/**
 * Every player, every column ESPN publishes, plus the three lines a reader
 * asks for first.
 *
 * **Columns come from the response, not from a list typed here.** ESPN's
 * box-score schema has changed before (the plus/minus column is not in every
 * era) and a hard-coded header would silently mislabel the whole table the
 * season it changes again. The leaders strip is computed from these same
 * parsed rows rather than from ESPN's separate `leaders` block, so the
 * headline and the table can never disagree.
 *
 * **A DNP is a row, not an omission.** Who was unavailable is a fact about
 * the game, and dropping those players makes a nine-man rotation look like a
 * choice rather than an injury list.
 */
function PlayerBoxScores({ box }: { box: GameBoxScore }) {
  return (
    <div className="mb-6 space-y-6">
      {box.teams.map((team) => (
        <TeamPlayers key={team.teamId} team={team} />
      ))}
    </div>
  )
}

function TeamPlayers({ team }: { team: TeamBoxScore }) {
  const played = team.players.filter((p) => !p.didNotPlay)
  const out = team.players.filter((p) => p.didNotPlay)

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-sm">
          <TeamLogo
            logo={team.logo}
            abbreviation={team.abbreviation}
            name={team.displayName}
            size={24}
          />
          {team.displayName ?? team.abbreviation}
        </h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {team.leaders.map((leader) => (
            <span key={leader.label} className="text-[11px]">
              <span className="text-[var(--text-tertiary)]">{leader.label} </span>
              <span className="text-[var(--text-secondary)]">{leader.player} </span>
              <span className="numeric text-[var(--text-primary)]">
                {leader.value}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Player</th>
              {team.labels.map((label) => (
                <th key={label} scope="col" className="numeric text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {played.map((player) => (
              <tr key={player.id || player.name}>
                <td className="whitespace-nowrap">
                  <span className="text-[var(--text-primary)]">{player.name}</span>
                  {player.position ? (
                    <span className="ml-1.5 font-numeric text-[10px] text-[var(--text-tertiary)]">
                      {player.position}
                    </span>
                  ) : null}
                  {player.starter ? (
                    <span className="ml-1.5 font-numeric text-[9px] uppercase tracking-[0.1em] text-[var(--accent-primary)]">
                      st
                    </span>
                  ) : null}
                </td>
                {team.labels.map((label) => (
                  <td key={label} className="numeric text-right">
                    {player.stats[label] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
            {Object.keys(team.totals).length ? (
              <tr>
                <td className="text-[var(--text-secondary)]">Team</td>
                {team.labels.map((label) => (
                  <td
                    key={label}
                    className="numeric text-right text-[var(--text-primary)]"
                  >
                    {team.totals[label] ?? '—'}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {out.length ? (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Did not play:{' '}
          {out
            .map((p) => `${p.name}${p.reason ? ` (${p.reason})` : ''}`)
            .join(' · ')}
        </p>
      ) : null}
    </section>
  )
}

/**
 * What the model said, and what happened.
 *
 * The probability it gave the outcome that ACTUALLY happened leads, with
 * Brier beside it — "it gave this 16%" is what a person can reason about,
 * where a bare Brier is not.
 *
 * **The one-game caveat prints on a hit as well as a miss.** A hit read as
 * proof is the same error in the flattering direction.
 */
function RecordedForecast({
  game,
  homeWon,
  margin,
}: {
  game: ArchiveGame
  homeWon: boolean
  margin: number
}) {
  const pModel = game.p_model!
  const gaveOutcome = homeWon ? pModel : 1 - pModel
  const brier = (pModel - (homeWon ? 1 : 0)) ** 2
  const marketGave =
    game.p_market !== undefined
      ? homeWon
        ? game.p_market
        : 1 - game.p_market
      : null

  return (
    <section className="card mb-6 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">What the model said</h2>
        <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-warn)]">
          Backtest
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="eyebrow">It gave the winner</p>
          <p
            className={cn(
              'numeric mt-1 text-2xl',
              gaveOutcome >= 0.5
                ? 'text-[var(--accent-primary)]'
                : 'text-[var(--accent-loss)]',
            )}
          >
            {pct(gaveOutcome, 1)}
          </p>
        </div>
        <div>
          <p className="eyebrow">Brier</p>
          <p className="numeric mt-1 text-2xl text-[var(--text-primary)]">
            {num(brier, 4)}
          </p>
        </div>
        <div>
          <p className="eyebrow">The market gave it</p>
          <p className="numeric mt-1 text-2xl text-[var(--text-secondary)]">
            {marketGave !== null ? pct(marketGave, 1) : '—'}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border-color)] pt-3 sm:grid-cols-4">
        <Stat label="Proj. margin" value={signed(game.exp_margin ?? 0)} />
        <Stat
          label="Actual margin"
          value={`${homeWon ? '+' : '-'}${margin}`}
        />
        <Stat label="Proj. total" value={num(game.exp_total, 1)} />
        <Stat label="Actual total" value={String(game.home_score + game.away_score)} />
        <Stat label="Elo, away" value={num(game.elo_away, 0)} />
        <Stat label="Elo, home" value={num(game.elo_home, 0)} />
        <Stat label="Spread" value={spread(game.spread_home ?? null)} />
        <Stat
          label="Moneyline"
          value={
            game.ml_away !== undefined && game.ml_home !== undefined
              ? `${moneyline(game.ml_away)} / ${moneyline(game.ml_home)}`
              : '—'
          }
        />
      </dl>

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        <strong className="text-[var(--text-secondary)]">
          This is a reconstruction, not a published call.
        </strong>{' '}
        The model was refit on games strictly earlier than this one, so it
        never saw the result — but nobody read this number before tip-off
        either. And one game is one game: a single confident hit is no more
        evidence than a single confident miss. The record that means
        something is on{' '}
        <Link href="/accuracy" className="text-[var(--accent-info)] hover:underline">
          the accuracy page
        </Link>
        .
      </p>
    </section>
  )
}

/** Warehouse box columns, used only when ESPN cannot be reached. */
const BOX_ROWS: Array<[string, string]> = [
  ['fgm', 'FG made'], ['fga', 'FG att'], ['fg3m', '3P made'], ['fg3a', '3P att'],
  ['ftm', 'FT made'], ['fta', 'FT att'], ['reb', 'Rebounds'],
  ['oreb', 'Off. reb'], ['ast', 'Assists'], ['stl', 'Steals'],
  ['blk', 'Blocks'], ['tov', 'Turnovers'], ['pf', 'Fouls'],
]

/**
 * Team totals, side by side, from the SUMMARY endpoint.
 *
 * **This replaced a table that had one row in it.** The warehouse's team
 * columns were parsed with the summary endpoint's stat names while the
 * warehouse is built from the scoreboard, which spells them differently —
 * exactly one column matched, `assists`, so every archived game rendered a
 * "team box score" consisting of the assist count. The loader is fixed for
 * future ingests, but the complete set was already arriving here with the
 * player lines, so this reads it from there and needs no re-ingest at all.
 *
 * The percentage rows are derived from made and attempted rather than read
 * from the feed's own `FG%`, so a shooting line and its percentage can never
 * disagree on the same row.
 */
function TeamComparison({ box }: { box: GameBoxScore }) {
  if (box.teams.length < 2) return null
  const [first, second] = box.teams
  const labels = first.labels.filter(
    (label) => label !== 'MIN' && label !== '+/-',
  )
  if (!labels.length) return null

  const shooting: Array<[string, string]> = [
    ['FG', 'Field goals'],
    ['3PT', 'Three-pointers'],
    ['FT', 'Free throws'],
  ]

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm">Team totals</h2>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Stat</th>
              <th scope="col" className="numeric text-right">
                {first.abbreviation ?? first.displayName}
              </th>
              <th scope="col" className="numeric text-right">
                {second.abbreviation ?? second.displayName}
              </th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => {
              const a = first.totals[label]
              const b = second.totals[label]
              if (a === undefined && b === undefined) return null
              const shot = shooting.find(([key]) => key === label)
              return (
                <tr key={label}>
                  <td className="text-[var(--text-secondary)]">
                    {shot ? shot[1] : label}
                  </td>
                  <td className="numeric text-right">
                    {a ?? '—'}
                    {shot ? <Percent value={a} /> : null}
                  </td>
                  <td className="numeric text-right">
                    {b ?? '—'}
                    {shot ? <Percent value={b} /> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** The percentage behind a "36-92" shooting line, derived not read. */
function Percent({ value }: { value?: string }) {
  if (!value || !value.includes('-')) return null
  const [made, attempted] = value.split('-').map(Number)
  if (!Number.isFinite(made) || !Number.isFinite(attempted) || attempted <= 0) {
    return null
  }
  return (
    <span className="ml-1.5 text-[10px] text-[var(--text-tertiary)]">
      {pct(made / attempted, 1)}
    </span>
  )
}

function BoxScore({ game }: { game: ArchiveGame }) {
  const home = game.box_home!
  const away = game.box_away!
  const rows = BOX_ROWS.filter(([key]) => key in home || key in away)
  if (!rows.length) return null

  return (
    <section>
      <h2 className="mb-3 text-sm">Team box score</h2>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Stat</th>
              <th scope="col" className="numeric text-right">{game.away}</th>
              <th scope="col" className="numeric text-right">{game.home}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label]) => (
              <tr key={key}>
                <td className="text-[var(--text-secondary)]">{label}</td>
                <td className="numeric text-right">
                  {away[key] !== undefined ? num(away[key], 0) : '—'}
                </td>
                <td className="numeric text-right">
                  {home[key] !== undefined ? num(home[key], 0) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
        Read from the stored warehouse columns, which the scoreboard fills
        only partly. The complete set comes from ESPN and is shown above when
        that request succeeds.
      </p>
    </section>
  )
}

/* -------------------------------------------------------------- upcoming */

function UpcomingGame({
  game,
}: {
  game: NonNullable<ReturnType<typeof getGameForecasts>>['games'][number]
}) {
  return (
    <div>
      <header className="mb-6">
        <Link
          href="/games"
          className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
        >
          ← Upcoming games
        </Link>
        <p className="eyebrow mt-3">{gameTime(game.date_utc)}</p>
        <div className="mt-3 flex items-center justify-between gap-4">
          <ScoreSide
            team={game.away.abbreviation}
            meta={game.away}
            probability={game.p_away}
            record={recordLine(game.away.abbreviation)}
          />
          <span
            className="font-numeric text-xs text-[var(--text-tertiary)]"
            data-score="pending"
          >
            vs
          </span>
          <ScoreSide
            team={game.home.abbreviation}
            meta={game.home}
            probability={game.p_home}
            record={recordLine(game.home.abbreviation)}
            align="right"
          />
        </div>
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          {new Date(game.date_utc).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
            timeZone: 'America/New_York',
          })}
          {game.venue ? ` · ${game.venue}` : ''}
        </p>
      </header>

      <section className="card mb-6 p-4">
        <h2 className="mb-3 text-sm">Forecast</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Home win" value={pct(game.p_home)} />
          <Stat label="Proj. margin" value={signed(game.exp_margin)} />
          <Stat label="Proj. total" value={num(game.exp_total, 1)} />
          <Stat
            label="Proj. score"
            value={`${Math.round(game.exp_away_score)}–${Math.round(game.exp_home_score)}`}
          />
        </dl>
      </section>

      {game.value ? (
        <section className="card mb-6 p-4">
          <h2 className="mb-3 text-sm">Value surface</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Moneyline"
              value={`${moneyline(game.value.ml_away)} / ${moneyline(game.value.ml_home)}`}
            />
            <Stat label="No-vig home" value={pct(game.value.fair_home)} />
            <Stat label="Edge" value={pct(game.value.edge, 2)} />
            <Stat label="Kelly" value={pct(game.value.kelly, 2)} />
          </dl>
        </section>
      ) : (
        <section className="card mb-6 p-4">
          <h2 className="text-sm">No market line</h2>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            No sportsbook has published a price for this game yet, so there is
            nothing to compare the forecast against.
          </p>
        </section>
      )}

      <SeriesHistory
        away={game.away.abbreviation}
        home={game.home.abbreviation}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <FormPanel abbreviation={game.away.abbreviation} name={game.away.name} />
        <FormPanel abbreviation={game.home.abbreviation} name={game.home.name} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- context */

/**
 * When these two last met, and what happened.
 *
 * The first thing anybody looking up a fixture wants, and the thing a
 * probability on its own cannot give them. Every row is a link into the
 * full game page, so the history is browsable rather than decorative.
 *
 * **Absent history is stated, not hidden.** Two clubs with no meeting in the
 * corpus is a real fact — an expansion side, a relocation, a gap in the
 * ingest — and an empty section that silently disappears looks the same as
 * one that failed to load.
 */
function SeriesHistory({
  away,
  home,
  excludeId,
}: {
  away: string
  home: string
  excludeId?: string
}) {
  const meetings = meetingsBetween(away, home).filter((m) => m.id !== excludeId)
  const depth = getGameContext()?.h2h_depth ?? 6

  if (!meetings.length) {
    return (
      <section className="card mb-6 p-4">
        <h2 className="text-sm">No previous meeting</h2>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          These two have not met inside the 2004-onward corpus.
        </p>
      </section>
    )
  }

  const awayWins = meetings.filter((m) =>
    m.home === away ? m.home_score > m.away_score : m.away_score > m.home_score,
  ).length

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">Last {meetings.length} meetings</h2>
        <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
          {away} {awayWins} — {meetings.length - awayWins} {home}
        </span>
      </div>
      <div className="card divide-y divide-[var(--border-color)]">
        {meetings.map((meeting) => (
          <MeetingRow key={meeting.id} meeting={meeting} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
        The {depth} most recent meetings in the corpus, regular season and
        postseason alike. Every one opens its own page.
      </p>
    </section>
  )
}

function MeetingRow({ meeting }: { meeting: Meeting }) {
  const homeWon = meeting.home_score > meeting.away_score
  return (
    <Link
      href={`/games/${meeting.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-[var(--card-hover)]"
    >
      <span className="w-20 shrink-0 font-numeric text-[11px] text-[var(--text-tertiary)]">
        {new Date(meeting.date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: '2-digit',
          timeZone: 'America/New_York',
        })}
      </span>
      <span className="min-w-0 flex-1 font-numeric text-xs">
        <span
          className={
            homeWon ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'
          }
        >
          {meeting.away} {meeting.away_score}
        </span>
        <span className="mx-1.5 text-[var(--text-tertiary)]">@</span>
        <span
          className={
            homeWon ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
          }
        >
          {meeting.home} {meeting.home_score}
        </span>
      </span>
      {meeting.type !== 2 ? (
        <span className="font-numeric text-[10px] text-[var(--accent-warn)]">
          {SEASON_TYPE_LABEL[meeting.type]}
        </span>
      ) : null}
    </Link>
  )
}

/**
 * A club's last ten results as a strip of W/L pills.
 *
 * **The pills carry a letter, not just a colour.** A green square and a red
 * square are the same square to a red-green colour-blind reader, which is
 * roughly one man in twelve — and this is the densest colour-coded surface
 * on the site.
 */
function FormPanel({
  abbreviation,
  name,
}: {
  abbreviation: string
  name: string
}) {
  const games = formFor(abbreviation)
  const record = getGameContext()?.records[abbreviation]

  if (!games.length) {
    return (
      <section className="card p-4">
        <h2 className="text-sm">{name}</h2>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          No results recorded for this club in the corpus.
        </p>
      </section>
    )
  }

  const won = games.filter((g) => g.won).length

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">
          <Link href={`/teams/${abbreviation}`} className="hover:underline">
            {name}
          </Link>
        </h2>
        <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
          {record
            ? `${record.wins}–${record.losses} in ${record.season - 1}-${String(record.season).slice(2)}`
            : ''}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {games.map((game) => (
          <Link
            key={game.id}
            href={`/games/${game.id}`}
            title={`${game.home ? 'vs' : 'at'} ${game.opponent} · ${game.scored}-${game.allowed}`}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-sm font-numeric text-[10px] transition-opacity hover:opacity-80',
              game.won
                ? 'bg-[var(--accent-primary)] text-black'
                : 'bg-[var(--muted-bg)] text-[var(--text-secondary)]',
            )}
          >
            {game.won ? 'W' : 'L'}
          </Link>
        ))}
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        {won}–{games.length - won} in the last {games.length}, oldest on the
        right. Each one opens its game page.
      </p>
    </section>
  )
}

/* --------------------------------------------------------------- shared */

/** The most recent completed regular-season record, as a caption. */
function recordLine(abbreviation: string): string | undefined {
  const record = getGameContext()?.records[abbreviation]
  if (!record) return undefined
  return `${record.wins}–${record.losses} · ${record.season - 1}-${String(record.season).slice(2)}`
}

function ScoreSide({
  team,
  meta,
  score,
  probability,
  won,
  record,
  align = 'left',
}: {
  team: string
  meta?: { name?: string; logo?: string | null }
  score?: number
  probability?: number
  won?: boolean
  record?: string
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        align === 'right' && 'flex-row-reverse text-right',
      )}
    >
      <TeamLogo logo={meta?.logo} abbreviation={team} name={meta?.name} size={36} />
      <div className="min-w-0">
        <p className="truncate text-sm text-[var(--text-primary)]">
          {meta?.name ?? team}
        </p>
        {score !== undefined ? (
          <p
            className={cn(
              'numeric text-2xl',
              won ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
            )}
          >
            {score}
          </p>
        ) : null}
        {probability !== undefined ? (
          <p className="numeric text-lg text-[var(--text-secondary)]">
            {pct(probability)}
          </p>
        ) : null}
        {record ? (
          <p className="font-numeric text-[10px] text-[var(--text-tertiary)]">
            {record}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The point breakdown by period, with the running score beside it.
 *
 * **The cumulative column is the one people actually read.** Q1-Q4 answers
 * "who won the third", but the question a reader is reconstructing is "when
 * did this get away from them", and that needs the running total. Both are
 * here; neither is derivable at a glance from the other.
 */
function PeriodTable({
  awayLabel,
  homeLabel,
  qAway,
  qHome,
  ot,
  awayTotal,
  homeTotal,
}: {
  awayLabel: string
  homeLabel: string
  qAway: number[]
  qHome: number[]
  ot: number
  awayTotal: number
  homeTotal: number
}) {
  const periods = Math.max(qAway.length, qHome.length)
  const running = (quarters: number[], upTo: number) =>
    quarters.slice(0, upTo + 1).reduce((a, b) => a + b, 0)

  return (
    <section>
      <h2 className="mb-3 text-sm">Scoring by period</h2>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Team</th>
              {Array.from({ length: periods }, (_, i) => (
                <th key={i} scope="col" className="numeric text-right">
                  Q{i + 1}
                </th>
              ))}
              {ot > 0 ? (
                <th scope="col" className="numeric text-right">OT</th>
              ) : null}
              <th scope="col" className="numeric text-right">Final</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: awayLabel, quarters: qAway, total: awayTotal },
              { label: homeLabel, quarters: qHome, total: homeTotal },
            ].map((side) => {
              const regulation = side.quarters.reduce((a, b) => a + b, 0)
              return (
                <tr key={side.label}>
                  <td className="text-[var(--text-primary)]">{side.label}</td>
                  {Array.from({ length: periods }, (_, i) => (
                    <td key={i} className="numeric text-right">
                      {side.quarters[i] ?? '—'}
                    </td>
                  ))}
                  {ot > 0 ? (
                    <td className="numeric text-right">
                      {side.total - regulation}
                    </td>
                  ) : null}
                  <td className="numeric text-right text-[var(--text-primary)]">
                    {side.total}
                  </td>
                </tr>
              )
            })}
            <tr>
              <td className="text-[var(--text-tertiary)]">Running score</td>
              {Array.from({ length: periods }, (_, i) => (
                <td
                  key={i}
                  className="numeric text-right text-[var(--text-tertiary)]"
                >
                  {running(qAway, i)}–{running(qHome, i)}
                </td>
              ))}
              {ot > 0 ? (
                <td className="numeric text-right text-[var(--text-tertiary)]">
                  {awayTotal}–{homeTotal}
                </td>
              ) : null}
              <td className="numeric text-right text-[var(--text-tertiary)]">
                {awayTotal}–{homeTotal}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {ot > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          The OT column is the balance between regulation and the final score
          — the source publishes period totals, not each overtime separately.
        </p>
      ) : null}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  )
}
