import { NextResponse } from 'next/server'
import { getIngestionHealth } from '@/lib/ingestion'

import {
  getGameForecasts,
  getMarketBenchmark,
  getPowerRatings,
  getSeasonProjections,
} from '@/lib/artifacts'

export const dynamic = 'force-dynamic'

/**
 * Artifact presence and separately observed ingestion freshness.
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
  const ingestion = getIngestionHealth()
  const degraded = missing.length > 0 || ingestion.status !== 'fresh'

  return NextResponse.json(
    {
      status: degraded ? 'degraded' : 'ok',
      ingestion,
      artifacts,
      missing,
      timestamp: new Date().toISOString(),
    },
    { status: degraded ? 503 : 200 },
  )
}
