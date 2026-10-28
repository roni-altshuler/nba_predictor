import { buildTrackRecord } from '@/lib/trackRecord'

interface TimeCase {
  name: string
  generated_at: string
  tipoff_utc: string
  date_utc: string | null
  as_of: string
  eligible: boolean
}
const { cases } = require('../../../backend/tests/fixtures/published_record/timestamp-precision.json') as { cases: TimeCase[] }
const call = (id: string, overrides = {}) => ({ game_id: id, season: 2027,
  generated_at: '2027-01-01T12:00:00Z', tipoff_utc: '2027-01-02T00:00:00Z',
  model_version: 'first', home_team: 'HOM', away_team: 'AWY', p_home: .7, ...overrides })
const result = (id: string, overrides = {}) => ({ ...call(id), date_utc: '2027-01-02T00:00:00Z',
  home_won: true, margin: 10, total: 190, ...overrides })
const live = (games: unknown[], at = '2027-01-03T00:00:00Z') => ({ basis: 'live', season: 2027, generated_at: at, n: games.length, games })
const history = (rows: ReturnType<typeof call>[]) => ({ n: rows.length, forecasts: Object.fromEntries(rows.map(row => [row.game_id, row])) })

test.each(cases)('producer timestamp contract: $name', row => {
  const pick = call('precision', { generated_at: row.generated_at, tipoff_utc: row.tipoff_utc })
  const report = row.date_utc === null
    ? buildTrackRecord(live([], row.as_of), history([pick]), 2027)
    : buildTrackRecord(live([{ ...result('precision'), ...pick, date_utc: row.date_utc }], row.as_of), history([]), 2027)
  expect(report.available).toBe(true)
  expect(row.date_utc === null ? report.pending : report.settled).toHaveLength(Number(row.eligible))
})

test.each([
  ['2027-01-01T12:00:00.000100Z', '2027-01-01T12:00:00.000900Z', true],
  ['2027-01-01T12:00:00.000900Z', '2027-01-01T12:00:00.000100Z', false],
  ['2027-01-01T12:00:00.000100Z', '2027-01-01T12:00:00.0001Z', false],
  ['2027-01-01T13:00:00.000100+01:00', '2027-01-01T12:00:00.000100Z', false],
])('earliest call %s versus durable %s preserves exact selection', (recorded, durable, accepted) => {
  const report = buildTrackRecord(live([result('first', { generated_at: recorded })]),
    history([call('first', { generated_at: durable, p_home: .8, model_version: 'durable' })]), 2027)
  expect(report.settled).toHaveLength(Number(accepted))
  if (accepted) expect(report.settled[0]).toMatchObject({ generatedAt: recorded, probability: .7, version: 'first' })
})

test('equivalent saved tipoff offsets do not manufacture a first-call conflict', () => {
  const recorded = result('same', { generated_at: '2027-01-01T12:00:00.000100Z' })
  const saved = call('same', { generated_at: '2027-01-01T13:00:00.000100+01:00', tipoff_utc: '2027-01-01T19:00:00-05:00' })
  expect(buildTrackRecord(live([recorded]), history([saved]), 2027).settled).toHaveLength(1)
})

test('a genuinely different microsecond tipoff at the same publication instant stays a conflict', () => {
  const recorded = result('drift', { tipoff_utc: '2027-01-02T00:00:00.000100Z', date_utc: '2027-01-02T00:00:00.001Z' })
  const saved = call('drift', { tipoff_utc: '2027-01-02T00:00:00.000900Z' })
  expect(buildTrackRecord(live([recorded]), history([saved]), 2027).settled).toHaveLength(0)
})

test.each(['settled', 'unpicked', 'pending'] as const)('%s orders microseconds before using IDs', collection => {
  const rows = [
    result('A-later', { date_utc: '2027-01-02T00:00:00.000900Z', tipoff_utc: '2027-01-02T00:00:00.000900Z', home_won: false, margin: -10 }),
    result('Z-earlier', { date_utc: '2027-01-02T00:00:00.000100Z', tipoff_utc: '2027-01-02T00:00:00.000100Z' }),
  ].map(row => ({ ...row, p_home: collection === 'unpicked' ? .5 : .7 }))
  const report = collection === 'pending'
    ? buildTrackRecord(live([], '2027-01-01T20:00:00Z'), history(rows), 2027)
    : buildTrackRecord(live(rows), history([]), 2027)
  expect(report[collection]?.map(row => row.id)).toEqual(['Z-earlier', 'A-later'])
  if (collection === 'settled') {
    expect(report.settled.map(row => [row.correctSoFar, row.settledSoFar, row.recentCorrect, row.recentSettled])).toEqual([[1, 1, 1, 1], [1, 2, 1, 2]])
  }
})

test.each(['settled', 'unpicked', 'pending'] as const)('%s uses IDs only for truly equal UTC instants', collection => {
  const rows = [
    result('Z-equal', { date_utc: '2027-01-02T01:00:00.000100+01:00', tipoff_utc: '2027-01-02T01:00:00.000100+01:00' }),
    result('A-equal', { date_utc: '2027-01-02T00:00:00.0001Z', tipoff_utc: '2027-01-02T00:00:00.0001Z' }),
  ].map(row => ({ ...row, p_home: collection === 'unpicked' ? .5 : .7 }))
  const report = collection === 'pending'
    ? buildTrackRecord(live([], '2027-01-01T20:00:00Z'), history(rows), 2027)
    : buildTrackRecord(live(rows), history([]), 2027)
  expect(report[collection]?.map(row => row.id)).toEqual(['A-equal', 'Z-equal'])
})

test('cumulative and rolling counts follow precise result order across the twentieth game', () => {
  const rows = Array.from({ length: 21 }, (_, i) => result(`pick-${String(21 - i).padStart(2, '0')}`, {
    date_utc: `2027-01-02T00:00:00.${String(i + 1).padStart(6, '0')}Z`, home_won: i === 0, margin: i === 0 ? 10 : -10,
  }))
  const report = buildTrackRecord(live(rows), history([]), 2027)
  expect(report.settled[0].id).toBe('pick-21')
  expect(report.settled[20].id).toBe('pick-01')
  expect(report.settled.map(row => row.correctSoFar)).toEqual(Array(21).fill(1))
  expect(report.settled[19]).toMatchObject({ recentCorrect: 1, recentSettled: 20, recentAccuracy: 5 })
  expect(report.settled[20]).toMatchObject({ recentCorrect: 0, recentSettled: 20, recentAccuracy: 0, settledSoFar: 21 })
})
