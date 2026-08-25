import Link from 'next/link'

import { LiveBadge } from '@/components/live/LiveBadge'
import { StatTile } from '@/components/primitives/StatTile'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
import { periodLabel, type LiveScore } from '@/lib/espnLive'
import { gameTime, moneyline, num, pct, signed, spread } from '@/lib/format'
import { ProbabilityBar } from './ProbabilityBar'

/**
 * One game: the forecast, and — where a price exists — the value surface.
 *
 * Three rules this card encodes, each inherited from the sibling soccer
 * project where the corresponding mistake shipped:
 *
 * 1. **A missing market is rendered as missing.** Not as a zero edge, not as
 *    an empty bar. "No line published" and "no edge" are different facts and
 *    a card that shows them identically is lying about one of them.
 * 2. **A pre-game score reads `vs`, never `– - –`.** Two dashes where a
 *    scoreline belongs reads as data that failed to load.
 * 3. **The value flag is gated on the edge clearing our own measured
 *    calibration error.** Below that threshold, "value" is indistinguishable
 *    from the model being slightly miscalibrated, and the card says so.
 *
 * **The whole card is a link.** It looks like a thing you can open, so it
 * has to be one — a card that shows a matchup and does nothing when clicked
 * is the most common complaint any fixture list gets, and it was this one's.
 * The destination carries what a card cannot: the series history, both
 * sides' recent form, the score distribution, and after tip-off the box
 * score.
 *
 * **The `live` prop overlays reality on the forecast; it never replaces
 * it.** On game night the home slate hydrates into a client island that
 * polls ESPN's scoreboard and passes each card its own live row — score in
 * place of `vs`, period and clock where the tip time was, a LIVE pill, and
 * FINAL when it is over. The probability bar and projections stay exactly
 * where they were, because watching the forecast meet reality is the whole
 * point of the overlay. A `post` row that is not `completed` is a
 * postponement and renders as if nothing were live — ESPN publishes the
 * makeup under a new event id, so this card knows nothing about it.
 */
export function GameCard({
  game,
  live,
}: {
  game: GameForecast
  live?: LiveScore
}) {
  const value = game.value
  const favoured = game.p_home >= 0.5 ? game.home : game.away

  const inPlay = live?.state === 'in'
  const finished = live?.state === 'post' && live.completed
  const haveScore =
    (inPlay || finished) &&
    live!.homeScore !== null &&
    live!.awayScore !== null
  const phase = inPlay
    ? [periodLabel(live!.period), live!.displayClock].filter(Boolean).join(' · ')
    : ''

  return (
    <Link
      href={`/games/${game.game_id}`}
      className="card group block p-4 transition-colors hover:bg-[var(--card-hover)]"
      aria-label={`${game.away.name} at ${game.home.name}, ${gameTime(game.date_utc)} — full forecast and match detail`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        {inPlay ? (
          <span className="flex items-center gap-2">
            <LiveBadge />
            {phase ? (
              <span className="font-numeric text-[11px] text-[var(--text-secondary)]">
                {phase}
              </span>
            ) : null}
          </span>
        ) : finished ? (
          <span className="eyebrow text-[var(--text-secondary)]">Final</span>
        ) : (
          <span className="eyebrow">{gameTime(game.date_utc)}</span>
        )}
        {value?.flagged ? (
          <span className="font-numeric text-[10px] uppercase tracking-[0.14em] text-[var(--accent-primary)]">
            Edge {pct(value.edge, 1)}
          </span>
        ) : null}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <TeamLine team={game.away} />
        {haveScore ? (
          <span
            className="numeric shrink-0 text-lg text-[var(--text-primary)]"
            data-score={finished ? 'final' : 'live'}
          >
            {live!.awayScore}–{live!.homeScore}
          </span>
        ) : (
          <span
            className="font-numeric text-xs text-[var(--text-tertiary)]"
            data-score="pending"
          >
            vs
          </span>
        )}
        <TeamLine team={game.home} align="right" />
      </div>

      <ProbabilityBar
        awayLabel={game.away.abbreviation}
        homeLabel={game.home.abbreviation}
        pHome={game.p_home}
      />
      {inPlay || finished ? (
        <p className="mt-1.5 text-[10px] text-[var(--text-tertiary)]">
          Pre-game forecast — made before tip-off, not updated in play.
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--border-color)] pt-3">
        <StatTile dl label="Proj. margin">
          {`${favoured.abbreviation} ${signed(Math.abs(game.exp_margin))}`}
        </StatTile>
        <StatTile dl label="Proj. total">{num(game.exp_total, 1)}</StatTile>
        <StatTile dl label="Proj. score">
          {`${Math.round(game.exp_away_score)}–${Math.round(game.exp_home_score)}`}
        </StatTile>
      </dl>

      {value ? (
        <div className="mt-3 border-t border-[var(--border-color)] pt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="eyebrow">Market</span>
            <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
              vig {pct(value.overround, 1)}
            </span>
          </div>
          <dl className="grid grid-cols-4 gap-3">
            <StatTile dl label="ML">
              {`${moneyline(value.ml_away)} / ${moneyline(value.ml_home)}`}
            </StatTile>
            <StatTile dl label="Spread">{spread(value.spread_home)}</StatTile>
            <StatTile dl label="Total">
              {value.total_points ? num(value.total_points, 1) : '—'}
            </StatTile>
            <StatTile dl label="No-vig">
              {`${pct(value.fair_away, 0)} / ${pct(value.fair_home, 0)}`}
            </StatTile>
          </dl>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-numeric text-xs text-[var(--text-secondary)]">
              EV {signed(value.expected_value * 100, 1)}%
            </span>
            <span className="font-numeric text-xs text-[var(--text-secondary)]">
              Kelly {pct(value.kelly, 2)}
            </span>
            {!value.flagged ? (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                edge below the {pct(value.min_edge, 0)} floor — inside our own
                calibration error, so it is not called value
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-[var(--border-color)] pt-3 text-[11px] text-[var(--text-tertiary)]">
          No sportsbook line published for this game yet, so there is nothing
          to compare the forecast against.
        </p>
      )}

      <span className="mt-3 inline-flex items-center gap-1 font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-info)]">
        Match detail
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  )
}

/**
 * A side of the matchup: the club's mark, its three-letter code, its rating.
 *
 * **The mark leads and the abbreviation stays.** A logo is the fastest thing
 * on the card to recognise, which is why it is here — but a logo alone is an
 * image, and an image that fails to load, or is read by a screen reader, or
 * belongs to one of the several NBA clubs whose marks are near-identical at
 * 34px, has to fall back on something. `TeamLogo` carries the full club name
 * as its accessible label and degrades to the abbreviation rather than to a
 * broken image.
 */
function TeamLine({
  team,
  align = 'left',
}: {
  team: GameForecast['home']
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${
        align === 'right' ? 'flex-row-reverse text-right' : ''
      }`}
    >
      <TeamLogo
        logo={team.logo}
        abbreviation={team.abbreviation}
        name={team.name}
        size={34}
      />
      <div className="min-w-0">
        <p className="font-numeric text-sm text-[var(--text-primary)]">
          {team.abbreviation}
        </p>
        <p className="font-numeric text-[11px] text-[var(--text-tertiary)]">
          {Math.round(team.elo)}
        </p>
      </div>
    </div>
  )
}

