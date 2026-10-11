import { act, fireEvent, render, screen } from '@testing-library/react'
import openingSlate from '@/components/schedule/__tests__/fixtures/opening-slate.json'
import { TeamSchedule } from '@/components/schedule/TeamSchedule'
import type { GameForecast } from '@/lib/artifacts'
import { teamScheduleGames } from '@/lib/teamSchedule'

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))
const rows = teamScheduleGames(openingSlate as GameForecast[], 2)
const props = { games: rows, team: 'BOS', season: 2027, generatedAt: '2026-10-02T17:01:23Z', trainedThrough: '2026-06-14T00:30:00Z' }
beforeEach(() => window.history.replaceState(null, '', '/teams/BOS'))

test('names the season and snapshot times, and labels published estimates separately from scheduled status', () => {
  render(<TeamSchedule {...props} />)
  expect(screen.getByText('2026–27 · regular-season forecasts')).toBeInTheDocument()
  expect(screen.getByText(/Oct 2, 2026/)).toBeInTheDocument()
  expect(screen.getByText(/Jun 14, 2026/)).toBeInTheDocument()
  expect(screen.getByText('Away · scheduled')).toBeInTheDocument()
  expect(screen.getByText('BOS win probability')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open BOS at Detroit Pistons matchup' })).toHaveAttribute('href', '/games/401909088')
  expect(screen.getByRole('link', { name: 'View this day’s slate →' })).toHaveAttribute('href', '/games?date=2026-10-20&team=BOS')
})

test('restores a shared empty filter and offers reset without making up results', () => {
  window.history.replaceState(null, '', '/teams/BOS?other=keep&scheduleMonth=2026-10&scheduleVenue=home#team-schedule')
  render(<TeamSchedule {...props} />)
  expect(screen.getByLabelText('Schedule month')).toHaveValue('2026-10')
  expect(screen.getByRole('heading', { name: 'No published games match these filters' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Reset schedule' }))
  expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 1 published games')
  expect(window.location.search).toBe('?other=keep')
  expect(window.location.hash).toBe('#team-schedule')
})

test('popstate and same-path Next navigation restore the visible filter state', () => {
  const view = render(<TeamSchedule {...props} />)
  fireEvent.change(screen.getByLabelText('Schedule court'), { target: { value: 'home' } })
  expect(window.location.search).toBe('?scheduleVenue=home')
  act(() => {
    window.history.replaceState(null, '', '/teams/BOS?scheduleVenue=away')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(screen.getByLabelText('Schedule court')).toHaveValue('away')
  window.history.pushState(null, '', '/teams/BOS')
  view.rerender(<TeamSchedule {...props} />)
  expect(screen.getByLabelText('Schedule court')).toHaveValue('')
})

test('missing publication stays unavailable with no probability or fabricated record', () => {
  render(<TeamSchedule games={[]} team="BOS" season={null} generatedAt={null} />)
  expect(screen.getByRole('heading', { name: 'Schedule forecast unavailable' })).toBeInTheDocument()
  expect(screen.queryByText(/win probability/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Schedule month')).not.toBeInTheDocument()
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
})

test('progressive disclosure is shareable, clamped on reload and reset with the filters', () => {
  // Explicit synthetic repetitions for paging; no additional product fixtures.
  const paging = Array.from({ length: 9 }, (_, index) => ({ ...rows[0], id: `unit-paging-${index}` }))
  const view = render(<TeamSchedule {...props} games={paging} />)
  expect(screen.getByRole('status')).toHaveTextContent('Showing 6 of 9')
  fireEvent.click(screen.getByRole('button', { name: 'Show 3 more games' }))
  expect(screen.getByRole('status')).toHaveTextContent('Showing 9 of 9')
  expect(window.location.search).toContain('scheduleCount=12')
  view.unmount()
  render(<TeamSchedule {...props} games={paging} />)
  expect(screen.getByRole('status')).toHaveTextContent('Showing 9 of 9')
  fireEvent.change(screen.getByLabelText('Schedule court'), { target: { value: 'away' } })
  expect(screen.getByRole('status')).toHaveTextContent('Showing 6 of 9')
  expect(window.location.search).not.toContain('scheduleCount')
})
