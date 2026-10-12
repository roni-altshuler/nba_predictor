import { render, screen } from '@testing-library/react'
import HomePage from '@/app/(app)/page'
import openingSlate from '@/components/schedule/__tests__/fixtures/opening-slate.json'
import { getGameForecasts, getLiveRecord } from '@/lib/artifacts'
import type { GameForecasts, LiveRecord } from '@/lib/artifacts'

jest.mock('@/components/live/LiveScores', () => ({ useLiveScores: () => ({}) }))
jest.mock('@/lib/artifacts', () => ({ ...jest.requireActual('@/lib/artifacts'),
  getGameForecasts: jest.fn(), getLiveRecord: jest.fn() }))
const forecast = { season: 2027, season_start: '2026-10-20T19:00:00Z', generated_at: '2026-10-11T16:32:23Z',
  trained_through: '2026-06-14T00:30:00Z', games: openingSlate, n_games: 3, n_priced: 0, n_flagged: 0 } as GameForecasts
beforeEach(() => {
  jest.mocked(getGameForecasts).mockReturnValue(forecast)
  jest.mocked(getLiveRecord).mockReturnValue({ season: 2027, n: 0 } as LiveRecord)
})

test('preseason publication and zero settled regular-season forecasts are honest context', () => {
  const view = render(<HomePage />)
  expect(screen.getByText(/preseason publication/)).toHaveTextContent('No settled regular-season forecasts yet.')
  expect(screen.getByText(/Preseason exhibition forecasts are unavailable/)).toBeInTheDocument()
  expect(view.container.querySelectorAll('#home-games article')).toHaveLength(3)
  expect(view.container.querySelector('#home-season-outlook')).not.toHaveAttribute('open')
  expect(screen.queryByRole('article', { name: 'Selected matchup' })).not.toBeInTheDocument()
})

test('missing and empty publications show useful browsing links without manufactured games', () => {
  jest.mocked(getGameForecasts).mockReturnValue(null)
  const view = render(<HomePage />)
  expect(screen.getByRole('heading', { name: 'Published schedule unavailable' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Completed seasons →' })).toHaveAttribute('href', '/seasons')
  expect(view.container.querySelector('[data-game-id]')).toBeNull()
  jest.mocked(getGameForecasts).mockReturnValue({ ...forecast, games: [] })
  view.rerender(<HomePage />)
  expect(screen.getByRole('heading', { name: 'Published schedule unavailable' })).toBeInTheDocument()
  expect(view.container.querySelector('[data-game-id]')).toBeNull()
})

test('a different season or absent live record does not invent a zero settled count', () => {
  jest.mocked(getLiveRecord).mockReturnValue({ season: 2026, n: 0 } as LiveRecord)
  const view = render(<HomePage />)
  expect(screen.queryByText(/No settled regular-season forecasts yet/)).not.toBeInTheDocument()
  jest.mocked(getLiveRecord).mockReturnValue(null)
  view.rerender(<HomePage />)
  expect(screen.queryByText(/No settled regular-season forecasts yet/)).not.toBeInTheDocument()
})
