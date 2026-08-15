import { NextResponse } from 'next/server'

import { getPowerRatings } from '@/lib/artifacts'

export const dynamic = 'force-static'

export async function GET() {
  const ratings = getPowerRatings()
  if (!ratings) {
    return NextResponse.json({ error: 'no ratings published' }, { status: 404 })
  }
  return NextResponse.json(ratings)
}
