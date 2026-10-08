import { fireEvent, render, screen, within } from '@testing-library/react'
import { TeamShootingContext } from '@/components/scouting/TeamShootingContext'
import { buildShootingContext } from '@/lib/shootingContext'
import type { ArchiveGame, SeasonFile } from '@/lib/history'

let query = ''
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query) }))
const game: ArchiveGame = { id: 'prior', date: '2026-06-01T00:30:00Z', season: 2026, type: 3, phase: null,
  home: 'A', away: 'B', home_id: 1, away_id: 2, home_score: 100, away_score: 90, ot: 0, venue: null, neutral: false,
  box_home: { fgm: 40, fga: 80, fg3m: 10, fg3a: 30, fta: 0 }, box_away: { fga: 80, fta: 20 } }
const file: SeasonFile = { season: 2026, games: [game], standings: [], champion: null, series: [], accuracy: null, basis: 'backtest' }
const data = buildShootingContext({ gameDate: '2026-10-21T00:30:00Z', gameSeason: 2027, excludeId: 'upcoming',
  teams: [{ id: 1, abbreviation: 'A', name: 'Team A' }, { id: 2, abbreviation: 'B', name: 'Team B' }], files: [null, file], generatedAt: '2026-10-08T00:30:00Z' })
beforeEach(() => { query = ''; window.history.replaceState(null, '', '/games/upcoming?compareLeft=keep') })

test('offers explicit prior-season recovery and shows ET date, provenance, coverage and missing rates', () => {
  render(<TeamShootingContext data={data} />)
  expect(screen.getByText('No 2026–27 season archive is available.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'View prior-season reference' }))
  expect(screen.getByRole('status')).toHaveTextContent('Prior-season reference · 2025–26')
  expect(screen.getByText(/Before Oct 20, 2026 ET/)).toBeInTheDocument()
  expect(screen.getByText(/Archive built Oct 7, 2026 ET/)).toHaveTextContent('strictly earlier tip-offs')
  const table = screen.getByRole('table', { name: 'A recent shooting rates' })
  expect(within(table).getByText('56.3%')).toBeInTheDocument()
  expect(within(table).getByText('0.0', { exact: true })).toBeInTheDocument()
  expect(within(table).getAllByText('—')).toHaveLength(2)
  expect(screen.getAllByRole('link', { name: /May 31, 2026 ET/ })[0]).toHaveAttribute('href', '/games/prior')
  expect(new URLSearchParams(window.location.search).get('compareLeft')).toBe('keep')
})

test('shared selection and popstate restore season/window; invalid query uses the game season', () => {
  window.history.replaceState(null, '', '?scoutSeason=2026&scoutWindow=5')
  render(<TeamShootingContext data={data} />)
  expect(screen.getByLabelText('Season sample')).toHaveValue('2026')
  expect(screen.getByLabelText('Recent games')).toHaveValue('5')
  fireEvent.change(screen.getByLabelText('Recent games'), { target: { value: '10' } })
  expect(new URLSearchParams(window.location.search).get('scoutWindow')).toBe('10')
  window.history.replaceState(null, '', '?scoutSeason=unknown&scoutWindow=0')
  fireEvent(window, new PopStateEvent('popstate'))
  expect(screen.getByLabelText('Season sample')).toHaveValue('2027')
  expect(screen.getByLabelText('Recent games')).toHaveValue('10')
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('cached same-path Next query changes restore the controls without popstate', () => {
  const view = render(<TeamShootingContext data={data} />)
  window.history.replaceState(null, '', '?scoutSeason=2026&scoutWindow=5')
  query = window.location.search
  view.rerender(<TeamShootingContext data={data} />)
  expect(screen.getByLabelText('Season sample')).toHaveValue('2026')
  expect(screen.getByLabelText('Recent games')).toHaveValue('5')
})

test('missing archives and first-game empty samples do not render invented rates', () => {
  const absent = { ...data, scopes: data.scopes.map(scope => ({ ...scope, available: false, teams: [] })) }
  render(<TeamShootingContext data={absent} />)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
