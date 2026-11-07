import { render, screen, within } from '@testing-library/react'

import GamePage from '@/app/(app)/games/[id]/page'
import { SavedGamePrediction } from '@/components/accuracy/SavedGamePrediction'
import { getForecastHistory, getLiveRecord } from '@/lib/artifacts'
import { getArchivedGame, type ArchiveGame } from '@/lib/history'
import { buildTrackRecord } from '@/lib/trackRecord'

jest.mock('@/lib/artifacts', () => ({ getGameForecasts: () => null, getLiveRecord: jest.fn(), getForecastHistory: jest.fn() }))
jest.mock('@/lib/espn', () => ({ getEspnBoxScore: async () => null, getEspnWinProbability: async () => null, getEspnInjuries: async () => null }))
jest.mock('@/lib/history', () => ({
  getArchivedGame: jest.fn(), getAllStarEvent: () => null, getMatchups: () => null,
  getGameContext: () => null, meetingsBetween: () => [], formFor: () => [],
  SEASON_TYPE_LABEL: { 2: 'Regular season' },
  teamMetaFromStandings: () => ({ PHI: { name: 'Philadelphia 76ers' }, CLE: { name: 'Cleveland Cavaliers' } }),
}))
jest.mock('@/components/scouting/ShootingContextSection', () => ({ ShootingContextSection: () => null }))
jest.mock('@/components/schedule/MatchupSections', () => ({ MatchupSections: () => null }))
jest.mock('@/components/primitives/BackLink', () => ({ BackLink: () => null }))

// Frozen counterexample: the saved call favors Philadelphia, while the
// reconstruction favors Cleveland. Neither value may replace the other.
const game: ArchiveGame = {
  id: '401909093', date: '2026-10-22T23:00:00Z', season: 2027, type: 2,
  phase: 'Final', home: 'PHI', away: 'CLE', home_id: 23, away_id: 5,
  home_score: 114, away_score: 106, ot: 0, venue: null, neutral: false,
  p_model: 0.48128, basis: 'backtest',
}
const teams = { PHI: { name: 'Philadelphia 76ers' }, CLE: { name: 'Cleveland Cavaliers' } }
const evidence = (probability = 0.510897, homeWon = true) => {
  const call = { generated_at: '2026-08-16T15:09:09Z', model_version: '2026.08.1+943bde8b', season: 2027,
    tipoff_utc: game.date, home_team: 'PHI', away_team: 'CLE', p_home: probability }
  return {
    live: { basis: 'live', season: 2027, generated_at: '2026-10-23T06:00:00Z', n: 1,
      games: [{ ...call, game_id: game.id, date_utc: game.date, home_won: homeWon, margin: homeWon ? 8 : -8, total: 220 }] },
    history: { n: 1, forecasts: { [game.id]: call } },
  }
}
const show = (g = game, probability = 0.510897, homeWon = true) => {
  const { live, history } = evidence(probability, homeWon)
  render(<SavedGamePrediction game={g} report={buildTrackRecord(live, history, g.season)} teams={teams} />)
  return screen.getByRole('region', { name: 'Saved pregame prediction' })
}

test('shows the original pick, final winner and ledger grade despite an opposite reconstruction', () => {
  const card = show()
  expect(within(card).getByText('51.1% win chance')).toBeInTheDocument()
  expect(within(card).getAllByText('Philadelphia 76ers')).toHaveLength(2)
  expect(within(card).getByText('Correct', { exact: true })).toBeInTheDocument()
  expect(card).toHaveTextContent('2026.08.1+943bde8b')
  expect(card).toHaveTextContent('Aug 16, 2026')
  expect(within(card).getByRole('link')).toHaveAttribute('href', '/accuracy#pick-401909093')
  expect(card).not.toHaveTextContent('48.1%')
})

test('a published incorrect pick remains a loss when the archive reconstruction favors the winner', () => {
  const card = show({ ...game, home_score: 106, away_score: 114, p_model: 0.3 }, 0.510897, false)
  expect(within(card).getByText('Incorrect', { exact: true })).toBeInTheDocument()
  expect(card).toHaveTextContent('Cleveland Cavaliers')
  expect(card).toHaveTextContent('51.1% win chance')
})

test.each([0, 1])('keeps valid boundary probability %s and its verified grade', probability => {
  const homeWon = probability === 1
  const card = show({ ...game, home_score: homeWon ? 114 : 106, away_score: homeWon ? 106 : 114 }, probability, homeWon)
  expect(card).toHaveTextContent('100.0% win chance')
  expect(within(card).getByText('Correct', { exact: true })).toBeInTheDocument()
})

test('50/50 calls have no winner pick and are outside the winner-pick percentage', () => {
  const card = show(game, 0.5)
  expect(card).toHaveTextContent('No favorite · 50/50')
  expect(card).toHaveTextContent('No winner pick')
  expect(card).toHaveTextContent('outside the winner-pick percentage')
  expect(within(card).getByRole('link')).toHaveAttribute('href', '/accuracy#published-record')
})

test.each([
  ['team mismatch', { ...game, home: 'CLE', away: 'PHI' }],
  ['result mismatch', { ...game, home_score: 106, away_score: 114 }],
  ['tied archive result', { ...game, home_score: 114, away_score: 114 }],
])('does not transfer a grade across %s', (_label, g) => {
  const card = show(g as ArchiveGame)
  expect(card).toHaveTextContent('could not be matched')
  expect(card).toHaveTextContent('Not graded')
  expect(card).not.toHaveTextContent('51.1%')
})

test('a changed archive start cannot inherit the published grade within the same millisecond', () => {
  const { live, history } = evidence()
  live.games[0].date_utc = '2026-10-22T23:00:00.000100Z'
  render(<SavedGamePrediction game={{ ...game, date: '2026-10-22T23:00:00.000900Z' }} report={buildTrackRecord(live, history)} teams={teams} />)
  const card = screen.getByRole('region', { name: 'Saved pregame prediction' })
  expect(card).toHaveTextContent('could not be matched')
  expect(card).toHaveTextContent('Not graded')
})

test('equivalent recorded starts retain the grade across UTC offsets and fraction formatting', () => {
  const { live, history } = evidence()
  live.games[0].date_utc = '2026-10-22T23:00:00.000100Z'
  render(<SavedGamePrediction game={{ ...game, date: '2026-10-23T01:00:00.0001+02:00' }} report={buildTrackRecord(live, history)} teams={teams} />)
  expect(screen.getByRole('region', { name: 'Saved pregame prediction' })).toHaveTextContent('Correct')
})

test('an archived result never grades an awaiting-scoring call in the page', () => {
  const { live, history } = evidence()
  render(<SavedGamePrediction game={game} report={buildTrackRecord({ ...live, n: 0, games: [] }, history)} teams={teams} />)
  const card = screen.getByRole('region', { name: 'Saved pregame prediction' })
  expect(card).toHaveTextContent('Awaiting published scoring')
  expect(card).toHaveTextContent('Not graded')
  expect(card).not.toHaveTextContent('Correct')
})

test.each(['unavailable', 'missing', 'other season'])('keeps %s evidence distinct from an incorrect pick', state => {
  const { live } = evidence()
  const report = state === 'unavailable' ? buildTrackRecord(null, null)
    : state === 'other season' ? buildTrackRecord(live, null, 2026)
      : buildTrackRecord({ ...live, n: 0, games: [] }, { n: 0, forecasts: {} })
  render(<SavedGamePrediction game={game} report={report} teams={teams} />)
  expect(screen.getByRole('region', { name: 'Saved pregame prediction' })).toHaveTextContent('Not graded')
  expect(screen.queryByText('Incorrect', { exact: true })).not.toBeInTheDocument()
})

test.each([true, false])('the actual played route reads saved evidence with reconstruction present=%s', async present => {
  const { live, history } = evidence()
  ;(getArchivedGame as jest.Mock).mockReturnValue({ game: { ...game, p_model: present ? game.p_model : undefined }, season: { standings: [] } })
  ;(getLiveRecord as jest.Mock).mockReturnValue(live)
  ;(getForecastHistory as jest.Mock).mockReturnValue(history)
  render(await GamePage({ params: Promise.resolve({ id: game.id }) }))
  expect(screen.getByRole('region', { name: 'Saved pregame prediction' })).toHaveTextContent('51.1% win chance')
  expect(screen.getByText('Correct', { exact: true })).toBeInTheDocument()
  expect(present ? screen.getByRole('heading', { name: 'What the reconstruction estimated' })
    : screen.getByRole('heading', { name: 'No reconstructed forecast for this game' })).toBeInTheDocument()
  expect(getForecastHistory).toHaveBeenCalled()
})
