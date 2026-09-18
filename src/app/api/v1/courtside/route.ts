import { NextResponse } from 'next/server'
import { getGameForecasts } from '@/lib/artifacts'

export const dynamic = 'force-static'
export function GET() {
  const forecasts = getGameForecasts()
  return forecasts ? NextResponse.json(forecasts) : NextResponse.json({ error: 'No forecast published' }, { status: 503 })
}
