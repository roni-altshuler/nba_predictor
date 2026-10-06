import { fireEvent, render, screen, within, act } from '@testing-library/react'
import openingSlate from './fixtures/opening-slate.json'
import type { GameForecast } from '@/lib/artifacts'
import { DailySlate, validSlateDay } from '../DailySlate'

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))

// Frozen public October 2 rows: daily publication must not move test fixtures.
const games = openingSlate as GameForecast[]

beforeEach(() => window.history.replaceState(null, '', '/games'))

test('puts the late UTC game on its Eastern slate and opens real game detail links', () => {
  render(<DailySlate games={games} initialDay="2026-10-20" />)
  const slate = screen.getByRole('region', { name: 'Daily slate' })
  expect(within(slate).getByText('3 published games')).toBeInTheDocument()
  for (const game of games) expect(within(slate).getByRole('link', { name: new RegExp(`${game.away.name} at ${game.home.name}`) }))
    .toHaveAttribute('href', `/games/${game.game_id}`)
})

test('restores a shared empty date and franchise; reset is useful without fabricating games', () => {
  window.history.replaceState(null, '', '/games?date=2026-10-03&team=BOS')
  render(<DailySlate games={games} initialDay="2026-10-20" />)
  expect(screen.getByLabelText('Game date')).toHaveValue('2026-10-03')
  expect(screen.getByRole('heading', { name: 'No published games in this view' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Go to next published slate →' }))
  expect(screen.getByText('1 published game · BOS')).toBeInTheDocument()
  expect(window.location.search).toContain('date=2026-10-20')
  expect(window.location.search).toContain('team=BOS')
})

test('date and team changes create history entries and popstate restores the selection', () => {
  render(<DailySlate games={games} initialDay="2026-10-20" />)
  fireEvent.change(screen.getByLabelText('Filter by franchise'), { target: { value: 'BOS' } })
  expect(screen.getByText('1 published game · BOS')).toBeInTheDocument()
  act(() => {
    window.history.replaceState(null, '', '/games?date=2026-10-21')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(screen.getByLabelText('Filter by franchise')).toHaveValue('')
  expect(screen.getByLabelText('Game date')).toHaveValue('2026-10-21')
  expect(screen.getByRole('heading', { name: 'No published games in this view' })).toBeInTheDocument()
})

test('invalid dates and unknown teams cannot poison the slate state', () => {
  expect(validSlateDay('2026-02-30')).toBe(false)
  expect(validSlateDay('invalid')).toBe(false)
  expect(validSlateDay('2028-02-29')).toBe(true)
  window.history.replaceState(null, '', '/games?date=2026-02-30&team=FAKE')
  render(<DailySlate games={games} initialDay="2026-10-20" />)
  expect(screen.getByLabelText('Game date')).toHaveValue('2026-10-20')
  expect(screen.getByLabelText('Filter by franchise')).toHaveValue('')
})

test('same-path Next navigation restores the query without a popstate or changed forecast props', () => {
  const view = render(<DailySlate games={games} initialDay="2026-10-20" />)
  fireEvent.change(screen.getByLabelText('Game date'), { target: { value: '2026-10-21' } })
  fireEvent.change(screen.getByLabelText('Filter by franchise'), { target: { value: 'BOS' } })
  expect(screen.getByLabelText('Game date')).toHaveValue('2026-10-21')
  expect(screen.getByLabelText('Filter by franchise')).toHaveValue('BOS')
  // Next's query context updates after Link navigation; the slate stays mounted.
  window.history.pushState(null, '', '/games')
  view.rerender(<DailySlate games={games} initialDay="2026-10-20" />)
  expect(screen.getByLabelText('Game date')).toHaveValue('2026-10-20')
  expect(screen.getByLabelText('Filter by franchise')).toHaveValue('')
  expect(screen.getByText('3 published games')).toBeInTheDocument()
  window.history.replaceState(null, '', '/games?date=2026-10-21&team=BOS')
  view.rerender(<DailySlate games={games} initialDay="2026-10-20" />)
  expect(screen.getByLabelText('Game date')).toHaveValue('2026-10-21')
  expect(screen.getByLabelText('Filter by franchise')).toHaveValue('BOS')
})
