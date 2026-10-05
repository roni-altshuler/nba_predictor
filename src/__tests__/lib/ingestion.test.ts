import { ingestionHealth } from '@/lib/ingestion'

const now = new Date('2026-10-05T12:00:00Z')
const record = {
  source: 'espn', status: 'ok', seasons: [2027], warehouse_updated: true,
  last_success_at: '2026-10-05T11:00:00Z', event_count: 0,
}

test('a confirmed empty ingestion is fresh', () => {
  expect(ingestionHealth(record, now).status).toBe('fresh')
})

test('forecast generation never refreshes the ingestion clock', () => {
  expect(ingestionHealth({ ...record, last_success_at: '2026-10-03T11:00:00Z',
    generated_at: now.toISOString() }, now).status).toBe('stale')
})

test('an unavailable ingestion preserves its last success without claiming freshness', () => {
  expect(ingestionHealth({ ...record, status: 'unavailable' }, now)).toEqual({
    status: 'unavailable', last_success_at: record.last_success_at,
  })
})

test.each([null, {}, { ...record, seasons: [2026] }, { ...record, event_count: null },
  { ...record, last_success_at: 'bad' }, { ...record, last_success_at: '2026-10-06T11:00:00Z' },
  { ...record, warehouse_updated: false }])('missing or invalid evidence is unknown: %p', data => {
  expect(ingestionHealth(data, now).status).toBe('unknown')
})
