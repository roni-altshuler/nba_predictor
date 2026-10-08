import fs from 'node:fs'
import path from 'node:path'
import { buildShootingContext, shootingSelection } from '@/lib/shootingContext'
import type { ArchiveGame, SeasonFile } from '@/lib/history'

const box = { fgm: 40, fga: 80, fg3m: 10, fg3a: 30, fta: 20 }
const game = (id: string, date: string, extra: Partial<ArchiveGame> = {}): ArchiveGame => ({
  id, date, season: 2026, type: 2, phase: null, home: 'A', away: 'B', home_id: 1, away_id: 2,
  home_score: 100, away_score: 90, ot: 0, venue: null, neutral: false, box_home: box,
  box_away: { fgm: 30, fga: 100, fg3m: 0, fg3a: 10, fta: 0 }, ...extra,
})
const file = (games: ArchiveGame[], season = 2026): SeasonFile => ({ season, games, standings: [], champion: null, series: [], accuracy: null, basis: 'backtest' })
const teams = [{ id: 1, abbreviation: 'A', name: 'Team A' }, { id: 2, abbreviation: 'B', name: 'Team B' }]
const context = (games: ArchiveGame[], date = '2026-03-02T00:00:00Z') => buildShootingContext({ gameDate: date, gameSeason: 2026, excludeId: 'selected', teams, files: [file(games)], generatedAt: null })

test('strict cutoff excludes the selected game, same-time rows, future, invalid dates and preseason', () => {
  const data = context([game('earlier', '2026-03-01T00:00:00Z'), game('selected', '2026-02-01T00:00:00Z'),
    game('equal', '2026-03-02T00:00:00Z'), game('future', '2026-03-03T00:00:00Z'), game('bad-date', 'nonsense'),
    game('preseason', '2026-02-01T00:00:00Z', { type: 1 }), game('wrong-season', '2026-02-01T00:00:00Z', { season: 2025 })])
  expect(data.scopes[0].teams[0].samples[10].results.map(row => row.id)).toEqual(['earlier'])
  expect(context([game('earlier', '2026-03-01T00:00:00Z')], 'invalid').scopes[0].teams[0].samples[10].results).toEqual([])
})

test('weights rates by attempts, keeps home/away orientation and legitimate zero FT attempts', () => {
  const data = context([game('a', '2026-03-01T00:00:00Z'), game('b', '2026-02-28T00:00:00Z', {
    home_id: 2, away_id: 1, home: 'B', away: 'A', box_away: { fgm: 10, fga: 20, fg3m: 0, fg3a: 0, fta: 0 },
  })])
  const sample = data.scopes[0].teams[0].samples[10]
  expect(sample.offense.efg).toEqual({ numerator: 55, attempts: 100, games: 2, value: 0.55 })
  expect(sample.offense.threes.value).toBe(0.3)
  expect(sample.offense.freeThrows.value).toBe(0.2)
  expect(data.scopes[0].teams[1].samples[10].offense).toEqual(sample.opponent)
  expect(sample.results.map(row => row.home)).toEqual([true, false])
})

test('missing columns get separate coverage; missing and invalid denominators never become zeros', () => {
  const sample = context([game('full', '2026-03-01T00:00:00Z'), game('partial', '2026-02-28T00:00:00Z', { box_home: { fga: 80, fta: 0 } }),
    game('zero', '2026-02-27T00:00:00Z', { box_home: { fga: 0, fgm: 0, fg3m: 0, fg3a: 0, fta: 0 } }),
    game('negative', '2026-02-26T00:00:00Z', { box_home: { ...box, fga: -80 } })]).scopes[0].teams[0].samples[10]
  expect(sample.results).toHaveLength(4)
  expect(sample.offense.efg.games).toBe(1)
  expect(sample.offense.threes.games).toBe(1)
  expect(sample.offense.freeThrows).toEqual({ numerator: 20, attempts: 160, games: 2, value: 0.125 })
  const absent = context([game('missing', '2026-03-01T00:00:00Z', { box_home: undefined })]).scopes[0].teams[0].samples[10]
  expect(absent.offense.efg).toEqual({ value: null, games: 0, numerator: 0, attempts: 0 })
})

test('impossible made/attempted lines are excluded, but eFG is not incorrectly capped at 100%', () => {
  for (const invalidBox of [{ ...box, fg3m: 41 }, { ...box, fgm: 50, fg3m: 5, fg3a: 60 }]) {
    const invalid = context([game('invalid', '2026-03-01T00:00:00Z', { box_home: invalidBox })]).scopes[0].teams[0].samples[10]
    expect(invalid.offense.efg.value).toBeNull()
  }
  const valid = context([game('all-threes', '2026-03-01T00:00:00Z', { box_home: { fgm: 10, fga: 10, fg3m: 10, fg3a: 10, fta: 20 } })]).scopes[0].teams[0].samples[10]
  expect(valid.offense.efg.value).toBe(1.5)
  expect(valid.offense.freeThrows.value).toBe(2)
})

test('retains playoff, play-in, Cup and same-day rematch context; duplicate event IDs count once', () => {
  const games = [game('cup', '2026-02-27T00:00:00Z'), game('play-in', '2026-02-28T00:00:00Z', { type: 5 }),
    game('playoff', '2026-03-01T00:00:00Z', { type: 3, ot: 2 }), game('rematch', '2026-03-01T20:00:00Z')]
  const rows = context([...games, games[0]]).scopes[0].teams[0].samples[10].results
  expect(rows.map(row => row.id)).toEqual(['rematch', 'playoff', 'play-in', 'cup'])
  expect(rows[1]).toMatchObject({ phase: 'Playoffs', overtime: 2 })
})

test('current-season absence stays separate from an explicitly selected prior-season reference', () => {
  const data = buildShootingContext({ gameDate: '2026-10-20T23:00:00Z', gameSeason: 2027, excludeId: 'upcoming', teams,
    files: [null, file([game('prior', '2026-03-01T00:00:00Z')])], generatedAt: null })
  expect(data.scopes[0]).toMatchObject({ season: 2027, available: false })
  expect(data.scopes[0].teams[0].samples[10].results).toEqual([])
  expect(data.scopes[1].teams[0].samples[10].results[0].id).toBe('prior')
  expect(shootingSelection(data, '2026', '5')).toEqual({ season: 2026, window: 5 })
  expect(shootingSelection(data, '2004', '999')).toEqual({ season: 2027, window: 10 })
})

test('real archive snapshots remain unchanged when selected and later games are mutated', () => {
  const season = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backend/data/history/season_2026.json'), 'utf8')) as SeasonFile
  const priorSeason = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'backend/data/history/season_2025.json'), 'utf8')) as SeasonFile
  // Across regular season, play-in and playoffs: later scores and boxes cannot affect context.
  const selected = [season.games[100], season.games[700], ...season.games.filter(row => row.type === 5).slice(0, 2), season.games.at(-1)!]
  for (const target of selected) {
    const args = { gameDate: target.date, gameSeason: target.season, excludeId: target.id,
      teams: [{ id: target.away_id, abbreviation: target.away, name: target.away }, { id: target.home_id, abbreviation: target.home, name: target.home }], generatedAt: null }
    const before = buildShootingContext({ ...args, files: [season, priorSeason] })
    const altered = { ...season, games: season.games.map(row => Date.parse(row.date) >= Date.parse(target.date)
      ? { ...row, home_score: 999, away_score: 0, box_home: box, box_away: box } : row) }
    expect(buildShootingContext({ ...args, files: [altered, priorSeason] })).toEqual(before)
    for (const team of before.scopes[0].teams) {
      expect(team.samples[10].results.every(row => Date.parse(row.date) < Date.parse(target.date) && row.id !== target.id)).toBe(true)
      expect(team.samples[5].results).toEqual(team.samples[10].results.slice(0, 5))
    }
    expect(JSON.stringify(before).length).toBeLessThan(20000)
  }
})
