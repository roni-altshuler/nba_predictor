/** Descriptive winner-pick counts from published evidence, never a new forecast. */
export const RECENT_WINDOW = 20

export interface RecordedPick {
  id: string
  home: string
  away: string
  generatedAt: string
  tipoff: string
  probability: number
  version: string | null
  actualStart?: string
  homeWon?: boolean
  correct?: boolean
  correctSoFar?: number
  settledSoFar?: number
  accuracy?: number
  recentCorrect?: number
  recentSettled?: number
  recentAccuracy?: number
  versionChanged?: boolean
}

export interface TrackRecord {
  available: boolean
  season: number | null
  checkedAt: string | null
  settled: RecordedPick[]
  unpicked: RecordedPick[]
  pending: RecordedPick[] | null
  correct: number
  accuracy: number | null
  excluded: number
  missingCoverage: number | null
  completedCoverage: number | null
}

type Row = Record<string, unknown>
const object = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const byIdentity = (a: RecordedPick, b: RecordedPick) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0

/** Require an actual calendar date and explicit timezone, not Date.parse's local-time fallback. */
export function timestamp(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(v)
  if (!match) return false
  const [, y, m, d, h, min, sec] = match.map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
    && h < 24 && min < 60 && sec < 60 && Number.isFinite(Date.parse(v))
}

// Date.parse supplies UTC milliseconds. Keep the remaining fractional digits so
// comparisons match the producer's datetime precision, including UTC offsets.
// Python datetime truncates fractions beyond six digits rather than rounding.
function microseconds(value: string): bigint {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? ''
  return BigInt(Date.parse(value)) * 1000n + BigInt((fraction + '000000').slice(3, 6))
}

function compareTime(a: string, b: string): number {
  const left = microseconds(a), right = microseconds(b)
  return left < right ? -1 : left > right ? 1 : 0
}

function forecast(id: string, value: unknown, cutoff: bigint): RecordedPick | null {
  if (!object(value) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)
    || !timestamp(value.generated_at) || !timestamp(value.tipoff_utc)
    || microseconds(value.generated_at) >= microseconds(value.tipoff_utc)
    || microseconds(value.generated_at) > cutoff
    || typeof value.p_home !== 'number' || !Number.isFinite(value.p_home) || value.p_home < 0 || value.p_home > 1
    || typeof value.home_team !== 'string' || !value.home_team.trim()
    || typeof value.away_team !== 'string' || !value.away_team.trim() || value.home_team === value.away_team) return null
  return { id, home: value.home_team, away: value.away_team, generatedAt: value.generated_at,
    tipoff: value.tipoff_utc, probability: value.p_home,
    version: typeof value.model_version === 'string' && value.model_version ? value.model_version : null }
}

/** One season, earliest saved pre-event call, one confirmed eligible result per event. */
export function buildTrackRecord(live: unknown, history: unknown, season?: number): TrackRecord {
  const empty: TrackRecord = { available: false, season: season ?? null, checkedAt: null,
    settled: [], unpicked: [], pending: null, correct: 0, accuracy: null, excluded: 0, missingCoverage: null, completedCoverage: null }
  if (!object(live) || live.basis !== 'live' || !Number.isInteger(live.season) || !timestamp(live.generated_at)
    || (season !== undefined && live.season !== season) || !count(live.n) || !Array.isArray(live.games)
    || live.n !== live.games.length) return empty
  const report: TrackRecord = { ...empty, available: true, season: live.season as number, checkedAt: live.generated_at }
  const cutoff = microseconds(live.generated_at)
  const saved = new Map<string, RecordedPick>()
  const historyRows = object(history) && object(history.forecasts) ? history.forecasts : null
  const historyValid = historyRows !== null && (object(history) && (history.n === undefined || history.n === Object.keys(historyRows).length))
  if (historyValid && historyRows) {
    for (const [id, row] of Object.entries(historyRows)) {
      if (!object(row) || row.season !== live.season) continue
      const pick = forecast(id, row, cutoff)
      if (pick) saved.set(id, pick)
      else report.excluded++
    }
  }
  const occurrences = new Map<string, number>()
  for (const row of live.games) if (object(row) && typeof row.game_id === 'string') occurrences.set(row.game_id, (occurrences.get(row.game_id) ?? 0) + 1)
  const reported = new Set<string>()
  for (const value of live.games) {
    const row = object(value) ? value : {}
    const id = typeof row.game_id === 'string' ? row.game_id : ''
    reported.add(id)
    const pick = forecast(id, row, cutoff)
    const original = saved.get(id)
    // A warehouse-only earlier call may predate the durable log. A later or
    // contradictory call cannot silently replace the authoritative first one.
    const wrongSelection = original && pick && (compareTime(pick.generatedAt, original.generatedAt) > 0
      || (compareTime(pick.generatedAt, original.generatedAt) === 0
        && (pick.probability !== original.probability || pick.home !== original.home || pick.away !== original.away || compareTime(pick.tipoff, original.tipoff) !== 0
          || (pick.version !== null && original.version !== null && pick.version !== original.version))))
    const wrongSeason = historyValid && historyRows && object(historyRows[id]) && historyRows[id].season !== live.season
    const unverifiableSaved = historyValid && historyRows && Object.prototype.hasOwnProperty.call(historyRows, id) && !original
    const validResult = timestamp(row.date_utc) && microseconds(row.date_utc) <= cutoff && pick && compareTime(pick.generatedAt, row.date_utc) < 0
      && typeof row.home_won === 'boolean' && typeof row.margin === 'number' && Number.isInteger(row.margin) && row.margin !== 0
      && typeof row.total === 'number' && Number.isInteger(row.total) && row.total >= Math.abs(row.margin)
      && (row.total + row.margin) % 2 === 0 && row.home_won === (row.margin > 0)
    if (!pick || !validResult || wrongSelection || wrongSeason || unverifiableSaved || occurrences.get(id) !== 1) { report.excluded++; continue }
    const final = { ...pick, actualStart: row.date_utc as string, homeWon: row.home_won as boolean,
      correct: pick.probability === 0.5 ? undefined : (pick.probability > 0.5) === row.home_won }
    if (pick.probability === 0.5) report.unpicked.push(final)
    else report.settled.push(final)
  }
  report.settled.sort((a, b) => compareTime(a.actualStart!, b.actualStart!) || byIdentity(a, b))
  report.unpicked.sort((a, b) => compareTime(a.actualStart!, b.actualStart!) || byIdentity(a, b))
  report.settled.forEach((pick, i, rows) => {
    report.correct += Number(pick.correct)
    pick.correctSoFar = report.correct
    pick.settledSoFar = i + 1
    pick.accuracy = 100 * report.correct / (i + 1)
    const window = rows.slice(Math.max(0, i + 1 - RECENT_WINDOW), i + 1)
    pick.recentCorrect = window.filter(r => r.correct).length
    pick.recentSettled = window.length
    pick.recentAccuracy = 100 * pick.recentCorrect / window.length
    pick.versionChanged = i > 0 && pick.version !== null && rows[i - 1].version !== null && pick.version !== rows[i - 1].version
  })
  report.accuracy = report.settled.length ? 100 * report.correct / report.settled.length : null
  const coverage = object(live.coverage) ? live.coverage : null
  const coverageValid = !report.excluded && coverage && count(coverage.settled_games) && coverage.scored_games === report.settled.length + report.unpicked.length
    && count(coverage.without_eligible_forecast) && coverage.settled_games === report.settled.length + report.unpicked.length + coverage.without_eligible_forecast
    && Array.isArray(coverage.without_eligible_forecast_ids)
    && coverage.without_eligible_forecast_ids.every(id => typeof id === 'string')
    && new Set(coverage.without_eligible_forecast_ids).size === coverage.without_eligible_forecast
    && coverage.without_eligible_forecast_ids.length === coverage.without_eligible_forecast
  const unscored = coverageValid ? new Set<string>(coverage.without_eligible_forecast_ids as string[]) : new Set<string>()
  report.pending = historyValid ? [...saved.values()].filter(r => !reported.has(r.id) && !unscored.has(r.id)).sort((a, b) => compareTime(a.tipoff, b.tipoff) || byIdentity(a, b)) : null
  if (coverageValid && coverage && count(coverage.without_eligible_forecast) && count(coverage.settled_games)) {
    report.missingCoverage = coverage.without_eligible_forecast
    report.completedCoverage = coverage.settled_games
  }
  return report
}
