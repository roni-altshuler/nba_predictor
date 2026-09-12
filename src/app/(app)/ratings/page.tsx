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
        <p className="mt-2 font-numeric text-[11px] text-[var(--text-tertiary)]">
          model {ratings.model_version} · generated {stamp(ratings.generated_at)}{' '}
          · 100 Elo ≈ 3.5 points of margin
        </p>
      </header>

      <RatingsTable teams={ratings.teams} />

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Elo with a margin-of-victory multiplier, regressed 40% toward the mean
        between seasons — measured, not assumed.{' '}
        <Link
          href="/about#regression"
          className="text-[var(--accent-info)] hover:underline"
        >
          Why ratings regress
        </Link>
      </p>
    </div>
  )
}
