import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
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
 */
export function GameCard({ game }: { game: GameForecast }) {
  const value = game.value
  const favoured = game.p_home >= 0.5 ? game.home : game.away

  return (
    <article className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="eyebrow">{gameTime(game.date_utc)}</span>
        {value?.flagged ? (
          <span className="font-numeric text-[10px] uppercase tracking-[0.14em] text-[var(--accent-primary)]">
            Edge {pct(value.edge, 1)}
          </span>
        ) : null}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <TeamLine team={game.away} />
        <span
          className="font-numeric text-xs text-[var(--text-tertiary)]"
          data-score="pending"
        >
          vs
        </span>
        <TeamLine team={game.home} align="right" />
      </div>

      <ProbabilityBar
        awayLabel={game.away.abbreviation}
        homeLabel={game.home.abbreviation}
        pHome={game.p_home}
      />

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--border-color)] pt-3">
        <Stat label="Proj. margin" value={`${favoured.abbreviation} ${signed(Math.abs(game.exp_margin))}`} />
        <Stat label="Proj. total" value={num(game.exp_total, 1)} />
        <Stat
          label="Proj. score"
          value={`${Math.round(game.exp_away_score)}–${Math.round(game.exp_home_score)}`}
        />
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
            <Stat label="ML" value={`${moneyline(value.ml_away)} / ${moneyline(value.ml_home)}`} />
            <Stat label="Spread" value={spread(value.spread_home)} />
            <Stat label="Total" value={value.total_points ? num(value.total_points, 1) : '—'} />
            <Stat
              label="No-vig"
              value={`${pct(value.fair_away, 0)} / ${pct(value.fair_home, 0)}`}
            />
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
    </article>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  )
}
