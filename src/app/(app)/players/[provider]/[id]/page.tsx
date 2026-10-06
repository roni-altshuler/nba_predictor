import { notFound } from 'next/navigation'
import { PlayerProfileView } from '@/components/players/PlayerProfileView'
import { providerId } from '@/lib/athleteIdentity'
import { getPlayerProfile } from '@/lib/playerProfile'

export const metadata = { title: 'Player game profile', description: 'A verified ESPN single-game player line, with explicit coverage and source labels.' }

// Game/team search parameters select one known archived result. The existing
// ESPN summary stays force-cached; no career or roster requests are added.
export default async function PlayerPage({ params, searchParams }: {
  params: Promise<{ provider: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { provider, id } = await params
  if (provider !== 'espn' || !providerId(id)) notFound()
  const query = await searchParams
  const gameId = typeof query.game === 'string' ? providerId(query.game) : null
  const teamId = typeof query.team === 'string' ? providerId(query.team) : null
  const profile = await getPlayerProfile({ provider: 'espn', id }, gameId, teamId)
  return <PlayerProfileView profile={profile} />
}
