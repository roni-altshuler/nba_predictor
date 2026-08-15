import { NextResponse } from 'next/server'

import {
  getGameForecasts,
  getMarketBenchmark,
  getPowerRatings,
  getSeasonProjections,
} from '@/lib/artifacts'

export const dynamic = 'force-dynamic'

/**
 * Liveness plus artifact presence.
 *
 * Reports which artifacts are missing rather than returning a bare "ok".
 * A deploy whose pipeline has not run serves an empty site, and a health
 * check that cannot tell the difference is not a health check.
 */
export async function GET() {
  const artifacts = {
    season_projections: Boolean(getSeasonProjections()),
    game_forecasts: Boolean(getGameForecasts()),
    power_ratings: Boolean(getPowerRatings()),
    market_benchmark: Boolean(getMarketBenchmark()),
  }
  const missing = Object.entries(artifacts)
    .filter(([, present]) => !present)
    .map(([name]) => name)

  return NextResponse.json(
    {
      status: missing.length ? 'degraded' : 'ok',
      artifacts,
      missing,
      timestamp: new Date().toISOString(),
    },
    { status: missing.length ? 503 : 200 },
  )
}
