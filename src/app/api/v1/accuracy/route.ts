import { NextResponse } from 'next/server'

import { getMarketBenchmark, getSeriesModel } from '@/lib/artifacts'

export const dynamic = 'force-static'

export async function GET() {
  const market = getMarketBenchmark()
  if (!market) {
    return NextResponse.json({ error: 'no benchmark published' }, { status: 404 })
  }
  // The series record rides along but stays a SEPARATE key. Merging a
  // per-game Brier with a per-series Brier would produce a number that
  // describes neither.
  return NextResponse.json({ market, series: getSeriesModel() })
}
