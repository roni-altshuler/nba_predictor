import { fireEvent, render, screen, within } from '@testing-library/react'
import { GameLineComparison } from '@/components/players/GameLineComparison'
import type { ComparisonLine } from '@/lib/gameLineComparison'

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))
const lines: ComparisonLine[] = [
  { key: '25:espn:1', teamId: '25', name: 'QA First', reportedTeam: 'Seattle SuperSonics', href: '/players/espn/1?game=231030025&team=25', didNotPlay: false, reason: null, labels: ['PTS', 'FG', 'REB'], stats: { PTS: '0', FG: '0-2' } },
  { key: '17:espn:2', teamId: '17', name: 'QA Second', reportedTeam: 'New Jersey Nets', href: '/players/espn/2?game=231030025&team=17', didNotPlay: false, reason: null, labels: ['PTS', 'AST'], stats: { PTS: '12', AST: '3' } },
  { key: '17:espn:3', teamId: '17', name: 'QA Reserve', reportedTeam: null, href: '/players/espn/3?game=231030025&team=17', didNotPlay: true, reason: 'Inactive', labels: ['PTS', 'AST'], stats: {} },
]
beforeEach(() => window.history.replaceState(null, '', '/games/231030025'))

test('renders raw shooting strings, reported zero, missing cells, dated sample and source', () => {
  render(<GameLineComparison lines={lines} gameDate="2003-10-31T00:30:00Z" />)
  const table = screen.getByRole('table', { name: 'Selected player game statistics' })
  expect(within(table).getByText('0', { exact: true })).toBeInTheDocument()
  expect(within(table).getByText('0-2')).toBeInTheDocument()
  expect(within(table).getAllByText('—')).toHaveLength(4)
  expect(screen.getByText(/Final · Oct 30, 2003 ET/)).toBeInTheDocument()
  expect(screen.getByText(/Sample: 1 game per player/)).toHaveTextContent('without pace adjustment')
  expect(screen.getByRole('link', { name: 'Open QA First game profile' })).toHaveAttribute('href', lines[0].href)
})

test('supports DNP selection, distinct choices and a shareable URL without fabricating zeros', () => {
  render(<GameLineComparison lines={lines} gameDate="2003-10-31T00:30:00Z" />)
  const first = screen.getByLabelText('First player')
  fireEvent.change(first, { target: { value: lines[2].key } })
  expect(first).toHaveValue(lines[2].key)
  expect(screen.getByText('Did not play · Inactive')).toBeInTheDocument()
  expect(screen.getByText('Game-reported team unavailable')).toBeInTheDocument()
  expect(new URLSearchParams(window.location.search).get('compareLeft')).toBe(lines[2].key)
  expect(within(screen.getByLabelText('Second player')).getByRole('option', { name: 'QA Reserve · DNP' })).toBeDisabled()
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
  rows.forEach(row => expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('—'))
})

test('swap and browser history restoration keep the control, columns and URL together', () => {
  render(<GameLineComparison lines={lines} gameDate="2003-10-31T00:30:00Z" />)
  fireEvent.click(screen.getByRole('button', { name: 'Swap players' }))
  expect(screen.getByLabelText('First player')).toHaveValue(lines[1].key)
  expect(screen.getByLabelText('Second player')).toHaveValue(lines[0].key)
  window.history.replaceState(null, '', `?compareLeft=${encodeURIComponent(lines[2].key)}&compareRight=${encodeURIComponent(lines[0].key)}`)
  fireEvent(window, new PopStateEvent('popstate'))
  expect(screen.getByLabelText('First player')).toHaveValue(lines[2].key)
  expect(screen.getByLabelText('Second player')).toHaveValue(lines[0].key)
})

test('one or zero usable identities leaves the original box score available', () => {
  render(<GameLineComparison lines={lines.slice(0, 1)} gameDate="2003-10-31T00:30:00Z" />)
  expect(screen.getByRole('status')).toHaveTextContent('fewer than two players with usable provider IDs')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

test('two supplied identities with no source columns show an explicit empty statistics state', () => {
  render(<GameLineComparison lines={lines.slice(0, 2).map(line => ({ ...line, labels: [], stats: {} }))} gameDate="2003-10-31T00:30:00Z" />)
  expect(screen.getByText('Statistics unavailable for these game lines.')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})
