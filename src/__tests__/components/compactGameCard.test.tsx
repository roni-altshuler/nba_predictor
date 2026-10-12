import { render, screen } from '@testing-library/react'
import openingSlate from '@/components/schedule/__tests__/fixtures/opening-slate.json'
import { CompactGameCard } from '@/components/forecast/CompactGameCard'
import { LiveSlate } from '@/components/live/LiveSlate'
import type { GameForecast } from '@/lib/artifacts'
import type { LiveScore } from '@/lib/espnLive'

jest.mock('@/components/live/LiveScores', () => ({ useLiveScores: () => ({}) }))
const game = openingSlate[0] as GameForecast
const overlay = (fields: Partial<LiveScore> = {}): LiveScore => ({ id: game.game_id, state: 'in', completed: false,
  period: 1, displayClock: '12:00', awayScore: 0, homeScore: 0, startUtc: game.date_utc, ...fields })

test('schedule links reach real teams and matchup; projected numbers stay in a closed outlook', () => {
  const before = JSON.stringify(game)
  const view = render(<CompactGameCard game={game} />)
  expect(screen.getByRole('link', { name: `${game.away.name} team page` })).toHaveAttribute('href', `/teams/${game.away.abbreviation}`)
  expect(screen.getByRole('link', { name: `${game.home.name} team page` })).toHaveAttribute('href', `/teams/${game.home.abbreviation}`)
  expect(screen.getByRole('link', { name: 'Matchup & players →' })).toHaveAttribute('href', `/games/${game.game_id}`)
  expect(view.container.querySelector('[data-score="pending"]')).toHaveTextContent('vs')
  expect(view.container.querySelector('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/published win chance/).closest('details')).toBe(view.container.querySelector('details'))
  expect(screen.getByText(/Projected score/)).toHaveTextContent(`BOS ${Math.round(game.exp_away_score)}–DET ${Math.round(game.exp_home_score)}`)
  expect(view.container.querySelector('a a')).toBeNull()
  expect(JSON.stringify(game)).toBe(before)
})

test('confirmed zero scores are displayed, and live state never replaces the pre-game probability', () => {
  const view = render(<CompactGameCard game={game} live={overlay()} />)
  expect(view.container.querySelector('[data-score="live"]')).toHaveTextContent('0')
  expect(screen.getAllByText('0')).toHaveLength(2)
  expect(screen.getByText(/published win chance/)).toHaveTextContent(`${(game.p_home * 100).toFixed(1)}%`)
  view.rerender(<CompactGameCard game={game} live={overlay({ state: 'post', completed: true, awayScore: 102, homeScore: 104 })} />)
  expect(screen.getByText('Final')).toBeInTheDocument()
  expect(view.container.querySelector('[data-score="final"]')).toHaveTextContent('102')
})

test('missing scores and an unconfirmed post state cannot become zero or a final result', () => {
  const view = render(<CompactGameCard game={game} live={overlay({ awayScore: null })} />)
  expect(screen.getByText('Score unavailable')).toBeInTheDocument()
  expect(screen.queryByText('0')).not.toBeInTheDocument()
  view.rerender(<CompactGameCard game={game} live={overlay({ state: 'post', completed: false, awayScore: 90, homeScore: 95 })} />)
  expect(screen.queryByText('Final')).not.toBeInTheDocument()
  expect(screen.queryByText('90')).not.toBeInTheDocument()
  expect(screen.getByText('vs')).toBeInTheDocument()
})

test('a cleared overlay removes stale scores while retaining the published outlook', () => {
  const view = render(<CompactGameCard game={game} live={overlay({ awayScore: 51, homeScore: 54 })} />)
  expect(screen.getByText('51')).toBeInTheDocument()
  view.rerender(<CompactGameCard game={game} />)
  expect(screen.queryByText('51')).not.toBeInTheDocument()
  expect(screen.getByText('vs')).toBeInTheDocument()
  expect(screen.getByText(/published win chance/)).toBeInTheDocument()
})

test('compact slate keeps every supplied game instead of truncating after four', () => {
  // Explicit synthetic ID repetitions only for the coverage regression.
  const games = Array.from({ length: 7 }, (_, index) => ({ ...game, game_id: `unit-coverage-${index}` }))
  const view = render(<LiveSlate games={games} compact />)
  expect(view.container.querySelectorAll('article[data-game-id]')).toHaveLength(7)
  expect(screen.getAllByRole('link', { name: 'Matchup & players →' })).toHaveLength(7)
})
