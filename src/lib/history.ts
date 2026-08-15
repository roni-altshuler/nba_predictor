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
  series_id?: string
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

/**
 * The conference title race over time.
 *
 * Two files share this shape and the `basis` field is the whole difference:
 * `title_race_current.json` is LIVE — one point per day the forecast ran, and
 * those numbers were published in advance. `title_race_<season>.json` is a
 * BACKTEST — a completed season re-simulated at checkpoints, each using only
 * games earlier than it. A line chart implies somebody watched it happen, so
 * the component that draws these must say which one it is drawing.
 */
export interface TitleRaceTeam {
  name: string
  abbreviation: string
  conference: string
  logo: string | null
}

export interface TitleRaceCheckpoint {
  date: string
  games_played: number
  generated_at?: string
  model_version?: string
  probabilities: Record<string, number>
}

export interface TitleRace {
  season: number
  basis: 'live' | 'backtest'
  metric: string
  generated_at: string
  simulations?: number
  every_days?: number
  tracked_per_conference: number
  champion?: string | null
  teams: Record<string, TitleRaceTeam>
  checkpoints: TitleRaceCheckpoint[]
  note: string
}

export function getLiveTitleRace(): TitleRace | null {
  return readJson<TitleRace>('title_race_current.json')
}

export function getSeasonTitleRace(season: number | string): TitleRace | null {
  const value = Number(season)
  if (!Number.isInteger(value)) return null
  return readJson<TitleRace>(`title_race_${value}.json`)
}

/**
 * The context a fixture page needs before anyone has played it.
 *
 * A page carrying only a probability asserts a number and offers nothing to
 * weigh it against. This is the same material a search result gives you:
 * when these two last met and what happened, and how each side has been
 * playing. Published by `build_history.py`; nothing is computed here.
 */
export interface Meeting {
  id: string
  date: string
  season: number
  type: number
  home: string
  away: string
  home_score: number
  away_score: number
}

export interface FormGame {
  id: string
  date: string
  season: number
  opponent: string
  home: boolean
  scored: number
  allowed: number
  won: boolean
}

export interface GameContext {
  generated_at: string
  basis: string
  h2h_depth: number
  form_depth: number
  head_to_head: Record<string, Meeting[]>
  form: Record<string, FormGame[]>
  records: Record<string, { season: number; wins: number; losses: number }>
}

let contextCache: GameContext | null | undefined

export function getGameContext(): GameContext | null {
  if (contextCache === undefined) {
    contextCache = readJson<GameContext>('game_context.json')
  }
  return contextCache
}

/** Recent meetings between two clubs, most recent first. Order-independent. */
export function meetingsBetween(a: string, b: string): Meeting[] {
  const key = [a, b].sort().join('|')
  const found = getGameContext()?.head_to_head[key] ?? []
  return [...found].reverse()
}

/** A club's last games, most recent first. */
export function formFor(abbreviation: string): FormGame[] {
  const found = getGameContext()?.form[abbreviation] ?? []
  return [...found].reverse()
}

/**
 * All-Star weekend, which sits outside the model entirely.
 *
 * The sides are one-night drafts with no conference, so every franchise
 * filter on the site drops these games — correctly, since a rating means
 * nothing in a game where half the format is an untimed race to a target
 * score. That is exactly why they need publishing separately.
 */
export interface AllStarSide {
  team_id: number
  name: string
  abbreviation: string | null
  logo: string | null
}

export interface AllStarEvent {
  id: string
  date: string
  season: number
  phase: string
  label: string
  venue: string | null
  home: AllStarSide
  away: AllStarSide
  home_score: number
  away_score: number
  q_home?: number[]
  q_away?: number[]
}

export interface AllStarArchive {
  generated_at: string
  basis: string
  n_events: number
  note: string
  seasons: Array<{ season: number; label: string; events: AllStarEvent[] }>
}

let allStarCache: AllStarArchive | null | undefined

export function getAllStar(): AllStarArchive | null {
  if (allStarCache === undefined) {
    allStarCache = readJson<AllStarArchive>('allstar.json')
  }
  return allStarCache
}

/** One All-Star game by id — these are not in the season archive. */
export function getAllStarEvent(id: string): AllStarEvent | null {
  for (const season of getAllStar()?.seasons ?? []) {
    const found = season.events.find((event) => event.id === id)
    if (found) return found
  }
  return null
}

/**
 * The URL-safe half of a series id.
 *
 * Series ids are `2026:1v18` — season, colon, the two franchise ids. **The
 * colon cannot go in a path segment.** Next prerendered
 * `/seasons/2026/series/2026:1v18` quite happily and then 404'd every one of
 * them at runtime, encoded or not; a colon is reserved in a URL path and the
 * router will not match it. The season is already in the path, so the
 * segment is just the tail: `/seasons/2026/series/1v18`.
 */
export function seriesSlug(seriesId: string): string {
  const tail = seriesId.split(':').pop() || seriesId
  return tail.replace(/[^A-Za-z0-9_-]/g, '-')
}

/** Every game of one playoff series, in order. Takes the SLUG, not the id. */
export function getSeries(
  season: number | string,
  slug: string,
): { file: SeasonFile; series: SeasonFile['series'][number]; games: ArchiveGame[] } | null {
  const file = getSeason(season)
  if (!file) return null
  const series = file.series.find((s) => seriesSlug(s.series_id) === slug)
  if (!series) return null
  const games = file.games
    .filter((g) => g.series_id === series.series_id)
    .sort((a, b) => a.date.localeCompare(b.date))
  return { file, series, games }
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
