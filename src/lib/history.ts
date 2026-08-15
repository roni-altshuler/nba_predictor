/**
 * Reading the historical archive.
 *
 * Season files are large (~450KB each, 23 of them) so nothing here loads
 * more than the season actually asked for. `getSeasonsIndex` is the cheap
 * summary the listing page renders; a full season file is only read when a
 * season page or a game inside it is requested.
 *
 * **Every forecast in this archive is a BACKTEST.** The model was refit
 * monthly on games strictly earlier than the one it scores, so it never saw
 * the game — but nobody saw these numbers before those tip-offs either.
 * `basis: 'backtest'` rides on every record and the UI labels it wherever
 * it appears. A reconstructed forecast that blurs into "published in
 * advance" is the exact dishonesty this archive invites.
 */

import fs from 'node:fs'
import path from 'node:path'

const HISTORY_DIR = path.join(process.cwd(), 'backend', 'data', 'history')

export interface SeasonSummary {
  season: number
  label: string
  games: number
  champion: string | null
  best_record: { team: string; name: string; wins: number; losses: number } | null
  scored: number
  model_brier: number | null
  market_brier: number | null
}

export interface SeasonsIndex {
  generated_at: string
  basis: string
  warmup_seasons: number
  seasons: SeasonSummary[]
}

export interface ArchiveGame {
  id: string
  date: string
  season: number
  type: number
  phase: string | null
  home: string
  away: string
  home_id: number
  away_id: number
  home_score: number
  away_score: number
  ot: number
  venue: string | null
  neutral: boolean
  q_home?: number[]
  q_away?: number[]
  box_home?: Record<string, number>
  box_away?: Record<string, number>
  p_market?: number
  p_model?: number
  exp_margin?: number
  exp_total?: number
  elo_home?: number
  elo_away?: number
  ml_home?: number
  ml_away?: number
  spread_home?: number
  total_points?: number
  basis?: string
}

export interface StandingRow {
  team_id: number
  name: string
  abbreviation: string
  conference: string
  logo: string | null
  wins: number
  losses: number
  played: number
  win_pct: number
  points_for: number
  points_against: number
  point_diff: number
  net_rating: number
  home_wins: number
  home_losses: number
  away_wins: number
  away_losses: number
  conference_rank?: number
}

export interface SeasonFile {
  season: number
  games: ArchiveGame[]
  standings: StandingRow[]
  champion: string | null
  series: Array<{
    series_id: string
    round_slug: string
    depth: number | null
    team_a: string | null
    team_b: string | null
    wins_a: number
    wins_b: number
    winner: string | null
    completed: boolean
    first_game_utc: string | null
  }>
  accuracy: Record<string, unknown> | null
  basis: string
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8')) as T
  } catch {
    return null
  }
}

export function getSeasonsIndex(): SeasonsIndex | null {
  return readJson<SeasonsIndex>('seasons.json')
}

export function getSeason(season: number | string): SeasonFile | null {
  const value = Number(season)
  if (!Number.isInteger(value)) return null
  return readJson<SeasonFile>(`season_${value}.json`)
}

let gameIndexCache: Record<string, number> | null | undefined

export function getGameIndex(): Record<string, number> | null {
  if (gameIndexCache === undefined) {
    gameIndexCache = readJson<Record<string, number>>('game_index.json')
  }
  return gameIndexCache
}

/** Find one archived game by id, without loading every season. */
export function getArchivedGame(
  id: string,
): { game: ArchiveGame; season: SeasonFile } | null {
  const index = getGameIndex()
  const season = index?.[id]
  if (season === undefined) return null
  const file = getSeason(season)
  if (!file) return null
  const game = file.games.find((g) => g.id === id)
  return game ? { game, season: file } : null
}

export interface Matchups {
  season: number
  generated_at: string
  teams: Array<{
    team_id: number
    name: string
    abbreviation: string
    conference: string
    logo: string | null
  }>
  elo: Record<string, number>
  matchups: Array<{
    home: string
    away: string
    p_home: number
    exp_margin: number
    exp_total: number
    exp_home_score: number
    exp_away_score: number
  }>
  note: string
}

export function getMatchups(): Matchups | null {
  return readJson<Matchups>('matchups.json')
}

export interface RatingHistory {
  seasons: number[]
  teams: Record<string, Array<number | null>>
}

export function getRatingHistory(): RatingHistory | null {
  return readJson<RatingHistory>('rating_history.json')
}

/** Team metadata keyed by abbreviation, for logos and names. */
export function teamMetaFromStandings(
  standings: StandingRow[],
): Record<string, { abbreviation: string; name: string; logo: string | null; conference: string }> {
  const out: Record<string, { abbreviation: string; name: string; logo: string | null; conference: string }> = {}
  for (const row of standings) {
    out[row.abbreviation] = {
      abbreviation: row.abbreviation,
      name: row.name,
      logo: row.logo,
      conference: row.conference,
    }
  }
  return out
}

/** Games grouped by their Eastern calendar day, chronological. */
export function groupGamesByDay(
  games: ArchiveGame[],
): Array<[string, ArchiveGame[]]> {
  const buckets = new Map<string, ArchiveGame[]>()
  for (const game of games) {
    const day = new Date(new Date(game.date).getTime() - 5 * 3600 * 1000)
      .toISOString()
      .slice(0, 10)
    const existing = buckets.get(day)
    if (existing) existing.push(game)
    else buckets.set(day, [game])
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]))
}

export const SEASON_TYPE_LABEL: Record<number, string> = {
  1: 'Preseason',
  2: 'Regular season',
  3: 'Playoffs',
  4: 'All-Star',
  5: 'Play-in',
}
