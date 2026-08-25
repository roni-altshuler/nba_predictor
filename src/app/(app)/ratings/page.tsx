import Link from 'next/link'

import { TeamLabel } from '@/components/primitives/TeamLogo'
import { getPowerRatings } from '@/lib/artifacts'
import { stamp } from '@/lib/format'

export const metadata = { title: 'Power ratings' }
export const dynamic = 'force-static'

export default function RatingsPage() {
  const ratings = getPowerRatings()

  if (!ratings) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No ratings published</h1>
      </div>
    )
  }

  const best = ratings.teams[0]?.elo ?? 1500
  const worst = ratings.teams[ratings.teams.length - 1]?.elo ?? 1500
  const span = Math.max(best - worst, 1)

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Season {ratings.season}</p>
        <h1 className="mt-1 text-2xl">Power ratings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Elo with a margin-of-victory multiplier, tuned over 180
          configurations on 29,653 games. 100 rating points is roughly 3.5
          points of expected margin.
        </p>
      </header>

      <p className="mb-6 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Ratings regress 40% toward the mean between seasons — measured, not
        assumed.{' '}
        <Link
          href="/about#regression"
          className="text-[var(--accent-info)] hover:underline"
        >
          Why ratings regress
        </Link>
      </p>

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Team</th>
              <th scope="col">Conference</th>
              <th scope="col" className="numeric text-right">Elo</th>
              <th scope="col" className="w-1/3">Relative</th>
            </tr>
          </thead>
          <tbody>
            {ratings.teams.map((team) => (
              <tr key={team.team_id}>
                <td className="numeric text-[var(--text-tertiary)]">{team.rank}</td>
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
                <td className="text-[var(--text-tertiary)]">
                  {team.conference?.replace(' Conference', '') ?? '—'}
                </td>
                <td className="numeric text-right text-[var(--text-primary)]">
                  {Math.round(team.elo)}
                </td>
                <td>
                  <div className="prob-track">
                    <div
                      className="prob-fill"
                      style={{ width: `${((team.elo - worst) / span) * 100}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {ratings.model_version} · generated {stamp(ratings.generated_at)}
      </p>
    </div>
  )
}
