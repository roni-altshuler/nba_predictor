import { providerId, sameAthlete, type AthleteIdentity } from '@/lib/athleteIdentity'
import { getPowerRatings } from '@/lib/artifacts'
import { getEspnBoxScore, type PlayerLine } from '@/lib/espn'
import { getAllStarEvent, getArchivedGame, getSeasonsIndex } from '@/lib/history'

export interface PlayerGameContext {
  id: string
  date: string
  away: string
  home: string
  awayScore: number
  homeScore: number
  archivePublishedAt: string | null
  team: { id: string; name: string; abbreviation: string | null; href: string | null }
}

export type PlayerProfile = {
  identity: AthleteIdentity
  game: PlayerGameContext | null
} & (
  | { status: 'available'; player: PlayerLine; labels: string[] }
  | { status: 'unavailable'; reason: 'context_required' | 'game_not_published' | 'team_mapping_unavailable' | 'team_not_in_game' | 'box_score_unavailable' | 'player_not_in_game' }
)

/** One already-published game, using the same summary reader as the game page.
 * No athlete, roster or career endpoint, and no aggregation of partial coverage.
 */
export async function getPlayerProfile(identity: AthleteIdentity, gameId: string | null, teamId: string | null): Promise<PlayerProfile> {
  const unavailable = (reason: Extract<PlayerProfile, { status: 'unavailable' }>['reason'], game: PlayerGameContext | null = null): PlayerProfile => ({ identity, status: 'unavailable', reason, game })
  const eventId = providerId(gameId)
  const providerTeamId = providerId(teamId)
  if (identity.provider !== 'espn' || !providerId(identity.id) || !eventId || !providerTeamId) return unavailable('context_required')
  const archived = getArchivedGame(eventId)
  // Exhibition sides currently publish warehouse IDs only; do not treat those
  // as ESPN team IDs. A recorded provider mapping is needed before linking them.
  if (!archived) return unavailable(getAllStarEvent(eventId) ? 'team_mapping_unavailable' : 'game_not_published')

  const event = archived.game
  const sides = [event.home_id, event.away_id].map(warehouseId => {
    const team = archived.season.standings.find(t => t.team_id === warehouseId)
    const espnId = providerId(team?.espn_id)
    return team && espnId ? {
      id: espnId, warehouseId, abbreviation: team.abbreviation, name: team.name,
    } : null
  })
  if (sides.some(t => !t)) return unavailable('team_mapping_unavailable')
  const side = sides.find(t => t?.id === providerTeamId)
  if (!side) return unavailable('team_not_in_game')
  const game: PlayerGameContext = {
    id: event.id, date: event.date,
    away: event.away, home: event.home,
    awayScore: event.away_score, homeScore: event.home_score,
    team: { id: side.id, name: side.name, abbreviation: side.abbreviation, href: getPowerRatings()?.teams.some(t => t.team_id === side.warehouseId && t.abbreviation === side.abbreviation) ? `/teams/${side.abbreviation}` : null },
    archivePublishedAt: getSeasonsIndex()?.generated_at ?? null,
  }
  const box = await getEspnBoxScore(game.id)
  if (!box || box.gameId !== game.id) return unavailable('box_score_unavailable', game)
  const team = box.teams.find(t => t.teamId === providerTeamId)
  const player = team?.players.find(p => sameAthlete({ provider: p.provider, id: p.id }, identity))
  if (!player || !team) return unavailable('player_not_in_game', game)
  return { identity, status: 'available', game, player, labels: team.labels }
}
