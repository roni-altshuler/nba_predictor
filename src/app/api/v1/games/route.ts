import { NextResponse } from 'next/server'

import { getGameForecasts } from '@/lib/artifacts'

export const dynamic = 'force-static'

export async function GET() {
  const forecasts = getGameForecasts()
  if (!forecasts) {
    return NextResponse.json(
      { error: 'no game forecasts published' },
      { status: 404 },
    )
  }
  return NextResponse.json(forecasts)
}
