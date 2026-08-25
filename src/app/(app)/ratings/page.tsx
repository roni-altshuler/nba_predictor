import Link from 'next/link'

import { RatingsTable } from '@/components/ratings/RatingsTable'
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

      <RatingsTable teams={ratings.teams} />

      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        model {ratings.model_version} · generated {stamp(ratings.generated_at)}
      </p>
    </div>
  )
}
