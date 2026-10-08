import type { ArchiveGame, SeasonFile } from './history'

export type ShootingMetric = 'efg' | 'threes' | 'freeThrows'
export type ShootingWindow = 5 | 10
export interface ShootingRate {
  value: number | null
  games: number
  numerator: number
  attempts: number
}
export interface ShootingResult {
  id: string
  date: string
  opponent: string
  home: boolean
  phase: string
  overtime: number
  scored: number
  allowed: number
}
export interface ShootingSample {
  results: ShootingResult[]
  offense: Record<ShootingMetric, ShootingRate>
  opponent: Record<ShootingMetric, ShootingRate>
}
export interface ShootingTeam {
  id: number
  abbreviation: string
  name: string
}
export interface ShootingScope {
  season: number
  available: boolean
  teams: Array<ShootingTeam & { samples: Record<ShootingWindow, ShootingSample> }>
}
export interface ShootingContext {
  gameDate: string
  gameSeason: number
  generatedAt: string | null
  scopes: ShootingScope[]
}

export const shootingMetrics: Array<{ key: ShootingMetric; label: string; formula: string }> = [
  { key: 'efg', label: 'Effective FG', formula: '(FG made + 0.5 × 3P made) ÷ FG attempts' },
  { key: 'threes', label: '3-point shot share', formula: '3P attempts ÷ FG attempts' },
  { key: 'freeThrows', label: 'FT attempts / 100 FG', formula: '100 × FT attempts ÷ FG attempts' },
]

export function seasonLabel(season: number): string {
  return `${season - 1}–${String(season).slice(-2)}`
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** A separate valid denominator per metric: a missing 3P column is not zero. */
function shotValue(box: ArchiveGame['box_home'], metric: ShootingMetric): { numerator: number; attempts: number } | null {
  if (!box || !count(box.fga) || box.fga === 0) return null
  if (metric === 'freeThrows') return count(box.fta) ? { numerator: box.fta, attempts: box.fga } : null
  if (metric === 'threes') return count(box.fg3a) && box.fg3a <= box.fga ? { numerator: box.fg3a, attempts: box.fga } : null
  if (!count(box.fgm) || !count(box.fg3m) || box.fgm > box.fga || box.fg3m > box.fgm) return null
  if (count(box.fg3a) && (box.fg3m > box.fg3a || box.fg3a > box.fga || box.fgm - box.fg3m > box.fga - box.fg3a)) return null
  return { numerator: box.fgm + 0.5 * box.fg3m, attempts: box.fga }
}

function rates(games: ArchiveGame[], teamId: number, opponent: boolean): Record<ShootingMetric, ShootingRate> {
  return Object.fromEntries(shootingMetrics.map(({ key }) => {
    let numerator = 0, attempts = 0, covered = 0
    for (const game of games) {
      const home = game.home_id === teamId
      const value = shotValue(home !== opponent ? game.box_home : game.box_away, key)
      if (value) { numerator += value.numerator; attempts += value.attempts; covered++ }
    }
    return [key, { value: attempts > 0 ? numerator / attempts : null, games: covered, numerator, attempts }]
  })) as Record<ShootingMetric, ShootingRate>
}

function sample(games: ArchiveGame[], teamId: number): ShootingSample {
  return {
    results: games.map(game => {
      const home = game.home_id === teamId
      return { id: game.id, date: game.date, opponent: home ? game.away : game.home, home,
        phase: game.type === 3 ? 'Playoffs' : game.type === 5 ? 'Play-in' : 'Regular season / Cup',
        overtime: game.ot, scored: home ? game.home_score : game.away_score, allowed: home ? game.away_score : game.home_score }
    }),
    offense: rates(games, teamId, false),
    opponent: rates(games, teamId, true),
  }
}

/** Reconstruct final-box context from earlier tip-offs; never a forecast driver. */
export function buildShootingContext({ gameDate, gameSeason, excludeId, teams, files, generatedAt }: {
  gameDate: string
  gameSeason: number
  excludeId: string
  teams: ShootingTeam[]
  files: Array<SeasonFile | null>
  generatedAt: string | null
}): ShootingContext {
  const cutoff = Date.parse(gameDate)
  const scopes = [gameSeason, gameSeason - 1].map(season => {
    const file = files.find(value => value?.season === season)
    return { season, available: !!file, teams: teams.map(team => {
      const seen = new Set<string>()
      const games = (file?.games ?? [])
        .filter(game => game.season === season && game.id !== excludeId && [2, 3, 5].includes(game.type)
          && (game.home_id === team.id || game.away_id === team.id) && game.home_id !== game.away_id
          && Number.isFinite(cutoff) && Date.parse(game.date) < cutoff)
        .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id.localeCompare(a.id))
        .filter(game => { if (seen.has(game.id)) return false; seen.add(game.id); return true })
        .slice(0, 10)
      return { ...team, samples: { 5: sample(games.slice(0, 5), team.id), 10: sample(games, team.id) } }
    }) }
  })
  return { gameDate, gameSeason, generatedAt, scopes }
}

export function shootingSelection(data: ShootingContext, season: string | null, window: string | null): { season: number; window: ShootingWindow } {
  return { season: data.scopes.some(scope => String(scope.season) === season) ? Number(season) : data.gameSeason,
    window: window === '5' ? 5 : 10 }
}
