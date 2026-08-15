import { NextResponse } from 'next/server'

import { getSeasonProjections } from '@/lib/artifacts'

export const dynamic = 'force-static'

export async function GET() {
  const projections = getSeasonProjections()
  if (!projections) {
    return NextResponse.json(
      { error: 'no season projection published' },
      { status: 404 },
    )
  }
  return NextResponse.json(projections)
}
