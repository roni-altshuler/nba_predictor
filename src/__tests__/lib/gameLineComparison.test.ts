import { comparisonLines, comparisonPair } from '@/lib/gameLineComparison'
import type { GameBoxScore, PlayerLine, TeamBoxScore } from '@/lib/espn'

const player = (id: string, stats = { PTS: '0', REB: '7', IGNORED: '99' }, didNotPlay = false): PlayerLine => ({
  id, provider: 'espn', name: `Player ${id}`, shortName: id, position: 'G', jersey: '11',
  starter: true, didNotPlay, reason: didNotPlay ? 'Inactive' : null, stats,
})
const team = (id: string, players: PlayerLine[]): TeamBoxScore => ({ teamId: id, displayName: 'Seattle SuperSonics', abbreviation: 'SEA', logo: 'https://example.org/logo', labels: ['PTS', 'REB'], players, totals: { PTS: '100' }, leaders: [] })
const box: GameBoxScore = { gameId: '231030025', teams: [team('25', [player('1'), player('2', undefined, true)]), team('17', [player('3')])] }

test('retains provider identity and the supplied historical team name, with compact labelled values', () => {
  const [line] = comparisonLines(box)
  expect(line.key).toBe('25:espn:1')
  expect(line.reportedTeam).toBe('Seattle SuperSonics')
  expect(line.href).toBe('/players/espn/1?game=231030025&team=25')
  expect(line.stats).toEqual({ PTS: '0', REB: '7' })
  expect(line).not.toHaveProperty('logo')
  expect(line).not.toHaveProperty('totals')
})

test('DNP strips even stray source values, retaining the reason', () => {
  expect(comparisonLines(box)[1]).toMatchObject({ didNotPlay: true, reason: 'Inactive', stats: {} })
})

test('missing IDs and duplicate provider identities never become separate subjects', () => {
  const lines = comparisonLines({ ...box, teams: [team('25', [player(''), player('0'), player('1')]), team('17', [player('1'), player('3')])] })
  expect(lines.map(line => line.key)).toEqual(['25:espn:1', '17:espn:3'])
})

test('does not invent a team name or an unlabelled cell', () => {
  expect(comparisonLines({ ...box, teams: [{ ...team('25', [player('1')]), displayName: '  ', labels: ['AST'] }] })[0]).toMatchObject({ reportedTeam: null, stats: {} })
})

test('starts with opposing played lines and respects a distinct valid shared selection', () => {
  const lines = comparisonLines(box)
  expect(comparisonPair(lines, null, null)).toEqual({ left: '25:espn:1', right: '17:espn:3' })
  expect(comparisonPair(lines, '25:espn:2', '25:espn:1')).toEqual({ left: '25:espn:2', right: '25:espn:1' })
})

test('unknown, duplicate and wrong-team URL keys fall back only to known distinct lines', () => {
  const lines = comparisonLines(box)
  for (const [left, right] of [['nba:1', 'unknown'], ['25:espn:1', '25:espn:1'], ['18:espn:1', '0']]) {
    expect(comparisonPair(lines, left, right)).toEqual({ left: '25:espn:1', right: '17:espn:3' })
  }
  expect(comparisonPair([], null, null)).toEqual({ left: '', right: '' })
  expect(comparisonPair(lines.slice(0, 1), null, null)).toEqual({ left: '25:espn:1', right: '' })
})
