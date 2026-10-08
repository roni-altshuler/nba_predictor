import { getSeason, getSeasonsIndex, type SeasonFile } from '@/lib/history'
import { buildShootingContext, type ShootingTeam } from '@/lib/shootingContext'
import { TeamShootingContext } from './TeamShootingContext'

/** Read at most two archive files on the server, pass only bounded summaries. */
export function ShootingContextSection({ gameDate, gameSeason, gameId, teams, seasonFile }: {
  gameDate: string
  gameSeason: number
  gameId: string
  teams: ShootingTeam[]
  seasonFile?: SeasonFile
}) {
  const data = buildShootingContext({ gameDate, gameSeason, excludeId: gameId, teams,
    files: [seasonFile ?? getSeason(gameSeason), getSeason(gameSeason - 1)],
    generatedAt: getSeasonsIndex()?.generated_at ?? null })
  return <TeamShootingContext data={data} />
}
