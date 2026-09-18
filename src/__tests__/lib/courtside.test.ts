import { easternDay, validateForecasts } from '@/lib/courtside'
import { groupByWeek } from '@/lib/artifacts'
const source = require('../../../backend/data/predictions/game_forecasts.json')

test('Eastern slate handles daylight saving and winter offsets', () => {
  expect(easternDay('2026-10-21T04:30:00Z')).toBe('2026-10-21')
  expect(easternDay('2026-12-21T04:30:00Z')).toBe('2026-12-20')
})
test('week anchor uses the Eastern date of the opener', () => {
  const game = { ...source.games[0], date_utc: '2026-10-26T01:00:00Z' }
  expect(groupByWeek([game], game.date_utc)[0].week).toBe(1)
})
test('withholds malformed and duplicate forecasts without inventing probabilities', () => {
  const good = source.games[0]
  const data = validateForecasts({ ...source, games: [good, good, { ...good, game_id: 'bad', p_home: 2 }, { ...good, game_id: 'nan', exp_total: null }] })
  expect(data?.games).toHaveLength(1)
  expect(validateForecasts({ games: [] })).toBeNull()
})

test('prediction ranges widen with coverage around the same published mean', () => {
  const { predictionRange } = require('@/lib/courtside')
  expect(predictionRange(220, 20, 50)).toEqual([207, 233])
  expect(predictionRange(220, 20, 80)).toEqual([194, 246])
  expect(predictionRange(220, 20, 95)).toEqual([181, 259])
})
