import openingSlate from '@/components/schedule/__tests__/fixtures/opening-slate.json'
import type { GameForecast } from '@/lib/artifacts'
import { scheduleSelection, teamScheduleGames } from '@/lib/teamSchedule'

const games = openingSlate as GameForecast[]

test('orients the actual published away fields and strips other teams, ratings and value payloads', () => {
  const before = JSON.stringify(games)
  const rows = teamScheduleGames(games, 2)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ id: games[0].game_id, home: false, opponent: { abbreviation: 'DET' },
    probability: games[0].p_away, teamScore: games[0].exp_away_score, opponentScore: games[0].exp_home_score })
  expect(rows[0]).not.toHaveProperty('value')
  expect(rows[0].opponent).not.toHaveProperty('elo')
  expect(teamScheduleGames(games, games[0].home.team_id)[0]).toMatchObject({
    home: true, probability: games[0].p_home, teamScore: games[0].exp_home_score,
    opponentScore: games[0].exp_away_score,
  })
  expect(JSON.stringify(games)).toBe(before)
})

test('Eastern month bucketing and UTC ordering survive month boundaries and timestamp offsets', () => {
  // Explicit synthetic time variants of one frozen public matchup, only for this regression.
  const rows = teamScheduleGames([
    { ...games[0], game_id: 'later', date_utc: '2026-10-31T23:00:00-04:00' },
    { ...games[0], game_id: 'earlier', date_utc: '2026-11-01T00:30:00+00:00' },
  ], 2)
  expect(rows.map(row => row.id)).toEqual(['earlier', 'later'])
  expect(rows.map(row => row.day)).toEqual(['2026-10-31', '2026-10-31'])
})

test('invalid shared filters and unbounded counts recover to useful defaults', () => {
  expect(scheduleSelection(new URLSearchParams('scheduleMonth=2026-99&scheduleVenue=roof&scheduleCount=Infinity'), ['2026-10'], 80))
    .toEqual({ month: '', venue: '', count: 6 })
  expect(scheduleSelection(new URLSearchParams('scheduleMonth=2026-10&scheduleVenue=neutral&scheduleCount=96'), ['2026-10'], 80))
    .toEqual({ month: '2026-10', venue: 'neutral', count: 80 })
})
