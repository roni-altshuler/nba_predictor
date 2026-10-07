import { playerGameHref, providerId } from '@/lib/athleteIdentity'
import type { GameBoxScore } from '@/lib/espn'

/** The comparison receives only the lines from the game already being rendered. */
export interface ComparisonLine {
  key: string
  teamId: string
  name: string
  reportedTeam: string | null
  href: string | null
  didNotPlay: boolean
  reason: string | null
  labels: string[]
  stats: Record<string, string>
}

export interface ComparisonPair { left: string; right: string }

export function comparisonLines(box: GameBoxScore): ComparisonLine[] {
  const seen = new Set<string>()
  return box.teams.flatMap(team => team.players.flatMap(player => {
    const id = providerId(player.id)
    const teamId = providerId(team.teamId)
    const identity = `${player.provider}:${id}`
    // Duplicate provider IDs cannot identify two distinct comparison subjects.
    if (!id || !teamId || seen.has(identity)) return []
    seen.add(identity)
    return [{
      key: `${teamId}:${identity}`, teamId, name: player.name,
      reportedTeam: team.displayName?.trim() || null,
      href: playerGameHref({ provider: player.provider, id }, box.gameId, teamId),
      didNotPlay: player.didNotPlay, reason: player.reason,
      labels: [...new Set(team.labels)],
      // Ignore unlabelled values and any stray stats on a DNP row.
      stats: player.didNotPlay ? {} : Object.fromEntries(team.labels.flatMap(label => {
        const value = player.stats[label]
        return value === undefined || value === '' ? [] : [[label, value]]
      })),
    }]
  }))
}

/** Known distinct IDs only; prefer an opposing played line for the default. */
export function comparisonPair(lines: ComparisonLine[], left: string | null, right: string | null): ComparisonPair {
  const first = lines.find(line => line.key === left) ?? lines.find(line => !line.didNotPlay) ?? lines[0]
  const second = lines.find(line => line.key === right && line.key !== first?.key)
    ?? lines.find(line => line.key !== first?.key && line.teamId !== first?.teamId && !line.didNotPlay)
    ?? lines.find(line => line.key !== first?.key && !line.didNotPlay)
    ?? lines.find(line => line.key !== first?.key)
  return { left: first?.key ?? '', right: second?.key ?? '' }
}

export const comparisonLabel = (label: string) => ({
  MIN: 'Minutes', PTS: 'Points', REB: 'Rebounds', AST: 'Assists',
  FG: 'Field goals', '3PT': 'Three-pointers', FT: 'Free throws',
  OREB: 'Off. rebounds', DREB: 'Def. rebounds', STL: 'Steals',
  BLK: 'Blocks', TO: 'Turnovers', PF: 'Fouls', '+/-': 'Plus / minus',
} as Record<string, string>)[label] ?? label
