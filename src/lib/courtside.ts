import type { GameForecast, GameForecasts } from './artifacts'

/** NBA slate dates follow Eastern time, including daylight saving. */
const easternDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})
export function easternDay(iso: string): string {
  return easternDateFormatter.format(new Date(iso))
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
export function validGame(value: unknown): value is GameForecast {
  if (!object(value)) return false
  const g = value
  if (typeof g.game_id !== 'string' || !g.game_id || typeof g.date_utc !== 'string' ||
      !Number.isFinite(Date.parse(g.date_utc))) return false
  for (const side of [g.home, g.away]) {
    if (!object(side) || !Number.isInteger(side.team_id) || typeof side.name !== 'string' ||
        typeof side.abbreviation !== 'string' || !side.abbreviation || !finite(side.elo)) return false
  }
  if ((g.home as Record<string, unknown>).team_id === (g.away as Record<string, unknown>).team_id) return false
  return finite(g.p_home) && finite(g.p_away) && g.p_home >= 0 && g.p_home <= 1 &&
    g.p_away >= 0 && g.p_away <= 1 && Math.abs(g.p_home + g.p_away - 1) < 0.00001 &&
    ['exp_margin', 'exp_total', 'exp_home_score', 'exp_away_score', 'margin_sd', 'total_sd'].every(k => finite(g[k])) &&
    (g.margin_sd as number) > 0 && (g.total_sd as number) > 0
}

export function validateForecasts(value: unknown): GameForecasts | null {
  if (!object(value) || !Array.isArray(value.games) || typeof value.generated_at !== 'string' ||
      !Number.isFinite(Date.parse(value.generated_at)) || typeof value.model_version !== 'string' ||
      !Number.isInteger(value.season)) return null
  const seen = new Set<string>()
  const games = value.games.filter(validGame).filter(g => {
    if (seen.has(g.game_id)) return false
    seen.add(g.game_id)
    return true
  }).sort((a, b) => Date.parse(a.date_utc) - Date.parse(b.date_utc))
  return { ...value, games, n_games: games.length } as unknown as GameForecasts
}

/** Display-only intervals from the published Gaussian mean and residual SD.
 * They are model-implied prediction ranges, not confidence intervals on a mean.
 */
export function predictionRange(mean: number, sd: number, coverage: 50 | 80 | 95): [number, number] {
  const z = { 50: 0.6744897502, 80: 1.2815515655, 95: 1.9599639845 }[coverage]
  return [Math.round(mean - z * sd), Math.round(mean + z * sd)]
}
