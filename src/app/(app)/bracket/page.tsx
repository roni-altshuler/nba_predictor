import Link from 'next/link'

import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import { ProjectedBracket } from '@/components/playoffs/ProjectedBracket'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import {
  getProjectedBracket,
  getSeasonProjections,
  type ProjectedSeries,
} from '@/lib/artifacts'
import { num, pct, stamp } from '@/lib/format'
import { getSeasonsIndex } from '@/lib/history'

export const metadata = { title: 'Playoff bracket' }
export const dynamic = 'force-static'

const CONFERENCES = ['Eastern Conference', 'Western Conference'] as const

export default function BracketPage() {
  const bracket = getProjectedBracket()
  const projections = getSeasonProjections()
  const archive = (getSeasonsIndex()?.seasons ?? [])
    .filter((s) => s.champion)
    .sort((a, b) => b.season - a.season)
    .slice(0, 6)

  if (!bracket) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No bracket published</h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-tertiary)]">
          Run <code className="font-numeric">forecast_season</code> to generate{' '}
          <code>playoff_bracket.json</code>. Nothing is drawn here rather than
          an empty sixteen-team shell: a blank bracket looks like a bracket
          that has not started, and this one has not been computed.
        </p>
      </div>
    )
  }

  const preseason = bracket.games_played === 0

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Season {bracket.season}</p>
        <h1 className="mt-1 text-2xl">The road to the title</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Sixteen teams, four rounds, a mirrored board — the shape the league
          publishes. {preseason
            ? 'No games have been played, so every seed here is a projection and the number beside it is the probability that team actually finishes there.'
            : `${bracket.games_played.toLocaleString()} games are banked, so the seeding tightens with every result.`}
        </p>
      </header>

      <div className="mb-8">
        <ProjectedBracket bracket={bracket} />
      </div>

      {CONFERENCES.map((conference) => {
        const block = bracket.conferences[conference]
        if (!block) return null
        return (
          <section key={conference} className="mb-8">
            <h2 className="mb-3 text-sm">{conference} · first round</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {block.first_round.map((series) => (
                <SeriesCard
                  key={`${series.high_seed}-${series.low_seed}`}
                  series={series}
                />
              ))}
            </div>
          </section>
        )
      })}

      <section className="mb-8">
        <h2 className="mb-3 text-sm">How far each team gets</h2>
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col" className="numeric text-right">Playoffs</th>
                <th scope="col" className="numeric text-right">Semis</th>
                <th scope="col" className="numeric text-right">Conf. finals</th>
                <th scope="col" className="numeric text-right">Finals</th>
                <th scope="col" className="numeric text-right">Title</th>
              </tr>
            </thead>
            <tbody>
              {bracket.rounds
                .filter((t) => t.p_playoffs >= 0.01)
                .map((team) => (
                  <tr key={team.team_id}>
                    <td>
                      <span className="inline-flex items-center gap-2.5">
                        <TeamLogo
                          logo={team.logo}
                          abbreviation={team.abbreviation}
                          name={team.name}
                          size={22}
                        />
                        <span className="text-[var(--text-primary)]">
                          {team.name}
                        </span>
                      </span>
                    </td>
                    <td className="numeric text-right">{pct(team.p_playoffs, 0)}</td>
                    <td className="numeric text-right">{pct(team.p_conf_semis, 0)}</td>
                    <td className="numeric text-right">{pct(team.p_conf_finals, 0)}</td>
                    <td className="numeric text-right">{pct(team.p_finals, 0)}</td>
                    <td className="numeric text-right text-[var(--text-primary)]">
                      {pct(team.p_title)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Every column is a survival probability, so each one is no larger
          than the one to its left. Teams below a 1% playoff probability are
          omitted from this table — they are still in the simulation and still
          in the season projection, and the two totals will not match this
          view by design.
        </p>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm">Brackets that actually happened</h2>
          <Link
            href="/seasons"
            className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--accent-info)]"
          >
            All seasons
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {archive.map((season) => (
            <Link
              key={season.season}
              href={`/seasons/${season.season}`}
              className="card flex items-baseline justify-between p-3 transition-colors hover:bg-[var(--card-hover)]"
            >
              <span className="font-numeric text-xs text-[var(--text-secondary)]">
                {season.label}
              </span>
              <span className="font-numeric text-xs text-[var(--accent-warn)]">
                {season.champion}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="card mb-8 p-4">
        <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {bracket.note}
        </p>
      </div>

      <EvidencePanel measured={projections?.measured} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {bracket.model_version} · generated {stamp(bracket.generated_at)}
      </p>
    </div>
  )
}

/**
 * One projected series, with the thing a bracket cell has no room for: how
 * long it goes.
 *
 * "In six" is the modal outcome of most real series and a reader recognises
 * it where a bare probability is abstract. It is exact — a best-of-seven has
 * 2^7 paths, so enumerating them is cheaper than simulating them and carries
 * no sampling noise.
 */
function SeriesCard({ series }: { series: ProjectedSeries }) {
  const highFavoured = series.p_high_series >= 0.5
  return (
    <article className="card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="eyebrow">
          {series.high_seed} v {series.low_seed}
        </span>
        {series.modal_length ? (
          <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            most likely in {series.modal_length}
          </span>
        ) : null}
      </div>

      <SeriesSide
        side={series.high}
        seed={series.high_seed}
        probability={series.p_high_series}
        favoured={highFavoured}
      />
      <SeriesSide
        side={series.low}
        seed={series.low_seed}
        probability={series.p_low_series}
        favoured={!highFavoured}
      />

      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border-color)] pt-3">
        <div>
          <dt className="eyebrow">Per game, at home</dt>
          <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">
            {pct(series.p_high_game_home, 1)}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Per game, away</dt>
          <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">
            {pct(series.p_high_game_away, 1)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Two different numbers for the same matchup, which is why a series is
        not a coin weighted once: the higher seed hosts four of the seven, and
        the format turns {pct(series.p_high_game_home, 0)} at home into{' '}
        {pct(series.p_high_series, 0)} over the series.
      </p>
    </article>
  )
}

function SeriesSide({
  side,
  seed,
  probability,
  favoured,
}: {
  side: ProjectedSeries['high']
  seed: number
  probability: number
  favoured: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="w-3 shrink-0 font-numeric text-[10px] text-[var(--text-tertiary)]">
        {seed}
      </span>
      <TeamLogo
        logo={side.logo}
        abbreviation={side.abbreviation}
        name={side.name}
        size={26}
      />
      <div className="min-w-0 flex-1">
        <p
          className={
            favoured
              ? 'truncate text-sm text-[var(--text-primary)]'
              : 'truncate text-sm text-[var(--text-secondary)]'
          }
        >
          {side.name}
        </p>
        <p className="font-numeric text-[10px] text-[var(--text-tertiary)]">
          {num(side.wins ?? 0, 1)}–{num(side.losses ?? 0, 1)} projected ·{' '}
          {pct(side.p_seed, 0)} to land this seed
        </p>
      </div>
      <span
        className={
          favoured
            ? 'numeric text-lg text-[var(--accent-primary)]'
            : 'numeric text-lg text-[var(--text-tertiary)]'
        }
      >
        {pct(probability, 0)}
      </span>
    </div>
  )
}
