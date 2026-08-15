import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import { getGameForecasts } from '@/lib/artifacts'
import { gameTime, moneyline, num, pct, signed, spread } from '@/lib/format'
import {
  SEASON_TYPE_LABEL,
  getArchivedGame,
  teamMetaFromStandings,
  type ArchiveGame,
} from '@/lib/history'
import { cn } from '@/lib/utils'

export const dynamic = 'force-static'
// 31,844 archived games is far too many to prerender, and prerendering only
// some would 404 the rest. The route renders on demand and caches.
export const dynamicParams = true

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
  if (archived) return <PlayedGame game={archived.game} standings={archived.season.standings} />

  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) return <UpcomingGame game={upcoming} />

  notFound()
}

/* ---------------------------------------------------------------- played */

function PlayedGame({
  game,
  standings,
}: {
  game: ArchiveGame
  standings: Parameters<typeof teamMetaFromStandings>[0]
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
        <section className="mb-6">
          <h2 className="mb-3 text-sm">By quarter</h2>
          <div className="card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  {game.q_home.map((_, i) => (
                    <th key={i} scope="col" className="numeric text-right">
                      Q{i + 1}
                    </th>
                  ))}
                  {game.ot > 0 ? (
                    <th scope="col" className="numeric text-right">OT</th>
                  ) : null}
                  <th scope="col" className="numeric text-right">Final</th>
                </tr>
              </thead>
              <tbody>
                <QuarterRow
                  label={game.away}
                  quarters={game.q_away}
                  ot={game.ot}
                  total={game.away_score}
                />
                <QuarterRow
                  label={game.home}
                  quarters={game.q_home}
                  ot={game.ot}
                  total={game.home_score}
                />
              </tbody>
            </table>
          </div>
          {game.ot > 0 ? (
            <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
              The OT column is the balance between the four quarters and the
              final score — the source publishes period totals, not each
              overtime separately.
            </p>
          ) : null}
        </section>
      ) : null}

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

      {game.box_home && game.box_away ? (
        <BoxScore game={game} />
      ) : (
        <section className="card p-4">
          <h2 className="text-sm">No box score</h2>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            The source carried no team statistics for this game. Shown as
            missing rather than as a table of zeros.
          </p>
        </section>
      )}
    </div>
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

const BOX_ROWS: Array<[string, string]> = [
  ['fgm', 'FG made'], ['fga', 'FG att'], ['fg3m', '3P made'], ['fg3a', '3P att'],
  ['ftm', 'FT made'], ['fta', 'FT att'], ['reb', 'Rebounds'],
  ['oreb', 'Off. reb'], ['ast', 'Assists'], ['stl', 'Steals'],
  ['blk', 'Blocks'], ['tov', 'Turnovers'], ['pf', 'Fouls'],
]

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
        <section className="card p-4">
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
        <section className="card p-4">
          <h2 className="text-sm">No market line</h2>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            No sportsbook has published a price for this game yet, so there is
            nothing to compare the forecast against.
          </p>
        </section>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- shared */

function ScoreSide({
  team,
  meta,
  score,
  probability,
  won,
  align = 'left',
}: {
  team: string
  meta?: { name?: string; logo?: string | null }
  score?: number
  probability?: number
  won?: boolean
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
      </div>
    </div>
  )
}

function QuarterRow({
  label,
  quarters,
  ot,
  total,
}: {
  label: string
  quarters: number[]
  ot: number
  total: number
}) {
  const regulation = quarters.reduce((a, b) => a + b, 0)
  return (
    <tr>
      <td className="text-[var(--text-primary)]">{label}</td>
      {quarters.map((q, i) => (
        <td key={i} className="numeric text-right">{q}</td>
      ))}
      {ot > 0 ? (
        <td className="numeric text-right">{total - regulation}</td>
      ) : null}
      <td className="numeric text-right text-[var(--text-primary)]">{total}</td>
    </tr>
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
