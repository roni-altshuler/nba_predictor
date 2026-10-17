import { buildTrackRecord, RECENT_WINDOW, timestamp } from '@/lib/trackRecord'

const call = (id: string, overrides = {}) => ({ game_id: id, generated_at: '2026-08-16T12:00:00Z', tipoff_utc: '2027-01-01T00:00:00Z',
  model_version: 'published-v1', season: 2027, home_team: 'DET', away_team: 'BOS', p_home: 0.7, ...overrides })
const result = (id: string, overrides = {}) => ({ ...call(id), date_utc: '2027-01-01T00:00:00Z', home_won: true, margin: 10, total: 210, ...overrides })
const live = (games: unknown[], overrides = {}) => ({ season: 2027, basis: 'live', generated_at: '2027-06-01T00:00:00Z', n: games.length, games, ...overrides })
const history = (rows: ReturnType<typeof call>[]) => ({ n: rows.length, forecasts: Object.fromEntries(rows.map(r => [r.game_id, r])) })

test('genuine preseason publication has no percentage and keeps all saved calls pending', () => {
  const source = require('../../../backend/data/diagnostics/live_record.json')
  const saved = require('../../../backend/data/predictions/forecast_log.json')
  const report = buildTrackRecord(source, saved, 2027)
  expect(report.available).toBe(true)
  expect(report.settled).toHaveLength(0)
  expect(report.accuracy).toBeNull()
  expect(report.pending).toHaveLength(1200)
  expect(report.excluded).toBe(0)
  expect(report.missingCoverage).toBeNull()
})

test('same eligible records drive headline, chronological series and every-pick ledger', () => {
  const rows = [result('3', { p_home: 0.6 }), result('1'), result('2', { p_home: 0.2 })]
  const report = buildTrackRecord(live(rows), history([call('4')]))
  expect(report.settled.map(r => r.id)).toEqual(['1', '2', '3'])
  expect(report.correct).toBe(2)
  expect(report.accuracy).toBeCloseTo(200 / 3)
  expect(report.pending?.map(r => r.id)).toEqual(['4'])
  expect(report.settled.map(r => [r.correctSoFar, r.settledSoFar])).toEqual([[1, 1], [1, 2], [2, 3]])
  expect(report.settled.at(-1)?.accuracy).toBe(report.accuracy)
})

test('50/50 calls remain inspectable without inventing a correct winner pick or fractional game', () => {
  const report = buildTrackRecord(live([result('pick'), result('neutral', { p_home: 0.5 })]), history([]))
  expect(report.correct).toBe(1)
  expect(report.settled).toHaveLength(1)
  expect(report.unpicked).toHaveLength(1)
  expect(report.accuracy).toBe(100)
  expect(report.unpicked[0].correct).toBeUndefined()
})

test('version changes use actual metadata and never invent an update across an unknown version', () => {
  const rows = [result('1'), result('2', { model_version: 'v2' }), result('3', { model_version: null }), result('4', { model_version: 'v3' })]
  const report = buildTrackRecord(live(rows), history([]))
  expect(report.settled.map(r => r.versionChanged)).toEqual([false, true, false, false])
})

test('recent form has a fixed count window and shows the partial denominator', () => {
  const rows = Array.from({ length: 25 }, (_, i) => result(String(i).padStart(2, '0'), { home_won: i < 5, margin: i < 5 ? 10 : -10,
    date_utc: new Date(Date.UTC(2027, 0, i + 1)).toISOString() }))
  const report = buildTrackRecord(live(rows.reverse()), history([]))
  expect(RECENT_WINDOW).toBe(20)
  expect(report.accuracy).toBe(20)
  expect(report.settled[2].recentSettled).toBe(3)
  expect(report.settled[2].recentCorrect).toBe(3)
  expect(report.settled.at(-1)?.recentSettled).toBe(20)
  expect(report.settled.at(-1)?.recentAccuracy).toBe(0)
})

test('unequal weeks, partial weeks and year rollover aggregate counts rather than percentages', () => {
  const rows = ['2026-12-30T20:00:00Z', '2026-12-30T21:00:00Z', '2026-12-31T20:00:00Z', '2027-01-05T20:00:00Z'].map((date, i) => result(String(i), { date_utc: date, home_won: i < 3, margin: i < 3 ? 10 : -10 }))
  const report = buildTrackRecord(live(rows), history([]))
  expect(report.accuracy).toBe(75)
  expect(report.settled.at(-1)?.recentCorrect).toBe(3)
  expect(report.settled.at(-1)?.recentSettled).toBe(4)
  expect(report.settled[0].actualStart).toBe('2026-12-30T20:00:00Z')
})

test('season rollover excludes previous-season pending calls and a mismatched report', () => {
  const saved = history([call('old'), call('new', { season: 2028, tipoff_utc: '2027-12-01T00:00:00Z' })])
  expect(buildTrackRecord(live([], { season: 2028 }), saved, 2028).pending?.map(r => r.id)).toEqual(['new'])
  expect(buildTrackRecord(live([]), saved, 2028).available).toBe(false)
})

test.each([
  { generated_at: '2027-01-01T00:00:00Z' }, { generated_at: '2027-01-02T00:00:00Z' },
  { generated_at: '2026-08-16T12:00:00' }, { generated_at: '2026-02-30T12:00:00Z' },
  { generated_at: null }, { date_utc: null }, { date_utc: '2027-07-01T00:00:00Z' },
  { p_home: NaN }, { p_home: Infinity }, { p_home: 1.1 }, { p_home: true },
  { margin: 0 }, { margin: -10, home_won: true }, { total: 9 }, { total: 209 }, { home_won: null },
])('unverified or leaking evidence is excluded: %j', overrides => {
  const report = buildTrackRecord(live([result('safe'), result('bad', overrides)]), history([]))
  expect(report.settled.map(r => r.id)).toEqual(['safe'])
  expect(report.excluded).toBe(1)
  expect(report.accuracy).toBe(100)
})

test('a schedule moved earlier is checked against the actual recorded start', () => {
  const report = buildTrackRecord(live([result('late', { generated_at: '2026-12-31T23:00:00Z', date_utc: '2026-12-31T22:00:00Z' })]), history([]))
  expect(report.accuracy).toBeNull()
  expect(report.excluded).toBe(1)
})

test('duplicate events never select the favorable copy or inflate sample size', () => {
  const report = buildTrackRecord(live([result('same'), result('same', { home_won: false, margin: -10 })]), history([call('same')]))
  expect(report.settled).toHaveLength(0)
  expect(report.pending).toHaveLength(0)
  expect(report.accuracy).toBeNull()
})

test('earliest selection is preserved, including a genuinely older warehouse snapshot', () => {
  const saved = history([call('game')])
  expect(buildTrackRecord(live([result('game', { generated_at: '2026-08-17T12:00:00Z' })]), saved).settled).toHaveLength(0)
  expect(buildTrackRecord(live([result('game', { p_home: 0.9 })]), saved).settled).toHaveLength(0)
  expect(buildTrackRecord(live([result('game', { generated_at: '2026-08-15T12:00:00Z' })]), saved).settled).toHaveLength(1)
  expect(buildTrackRecord(live([result('game')]), history([call('game', { generated_at: null })])).settled).toHaveLength(0)
})

test('coverage distinguishes completed missing calls from pending and never assumes missing is zero', () => {
  const coverage = { settled_games: 2, scored_games: 1, without_eligible_forecast: 1, without_eligible_forecast_ids: ['unscored'] }
  const report = buildTrackRecord(live([result('scored')], { coverage }), history([call('scored'), call('unscored'), call('pending')]))
  expect(report.missingCoverage).toBe(1)
  expect(report.completedCoverage).toBe(2)
  expect(report.pending?.map(r => r.id)).toEqual(['pending'])
  expect(buildTrackRecord(live([]), null).pending).toBeNull()
  expect(buildTrackRecord(live([]), { forecasts: {}, n: 5 }).pending).toBeNull()
})

test('backtests, report count mismatches and unknown dates do not become a prospective zero', () => {
  expect(buildTrackRecord(live([], { basis: 'backtest' }), history([])).available).toBe(false)
  expect(buildTrackRecord(live([], { n: 1 }), history([])).available).toBe(false)
  expect(timestamp('2026-08-16T12:00:00')).toBe(false)
  expect(timestamp('2026-08-16T14:00:00+02:00')).toBe(true)
})
