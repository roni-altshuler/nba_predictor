import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Courtside } from '@/components/courtside/Courtside'
import { validateForecasts } from '@/lib/courtside'
const source = require('../../../backend/data/predictions/game_forecasts.json')
const initial = validateForecasts({ ...source, games: source.games.slice(0, 40) })!

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-18T10:00:00Z'))
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

test('following persists by public franchise abbreviation and filters the slate', () => {
  render(<Courtside initial={initial} />)
  const selected = within(screen.getByRole('article', { name: 'Selected matchup' }))
  const follow = selected.getAllByRole('button', { name: /Follow/ })[0]
  fireEvent.click(follow)
  expect(JSON.parse(localStorage.getItem('hardwood-following-v2')!)).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Following' }))
  expect(screen.getByRole('article', { name: 'Selected matchup' })).toBeInTheDocument()
})
test('shared matchup resolves to its date and does not modify published probabilities', () => {
  const game = initial.games[25]
  window.history.replaceState(null, '', `/lab?game=${game.game_id}`)
  render(<Courtside initial={initial} />)
  const article = screen.getByRole('article', { name: 'Selected matchup' })
  expect(within(article).getByRole('link', { name: /Game breakdown/ })).toHaveAttribute('href', `/games/${game.game_id}`)
  const probability = within(article).getByRole('img', { name: /%/ }).getAttribute('aria-label')
  fireEvent.click(within(article).getByRole('button', { name: `${game.home.abbreviation} wins` }))
  expect(within(article).getByRole('img', { name: /%/ })).toHaveAttribute('aria-label', probability)
  expect(within(article).getByRole('status')).toHaveTextContent('current record unavailable')
})
test('failed refresh retains existing forecasts and offers retry', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'))
  render(<Courtside initial={initial} />)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh forecasts' }))
  await act(async () => {})
  expect(screen.getByText(/Could not refresh/)).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'Selected matchup' })).toBeInTheDocument()
})
test('completed games are withheld and unavailable data has an explicit state', () => {
  render(<Courtside initial={{ ...initial, games: [{ ...initial.games[0], date_utc: '2026-09-01T00:00:00Z' }] }} />)
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(screen.getByText('No upcoming games match these filters.')).toBeInTheDocument()
})

test('franchise follows survive warehouse ID reassignment and an empty schedule', () => {
  localStorage.setItem('hardwood-following-v2', JSON.stringify(['BOS']))
  const team = { ...initial.games[0].away, team_id: 900, abbreviation: 'BOS', name: 'Boston Celtics' }
  render(<Courtside initial={{ ...initial, games: [] }} directory={[team]} />)
  fireEvent.click(screen.getByText('Your teams'))
  expect(screen.getByRole('button', { name: /Boston Celtics/ })).toHaveAttribute('aria-pressed', 'true')
})

test('filters are bookmarkable and restored on browser navigation', () => {
  render(<Courtside initial={initial} />)
  const team = initial.games[0].home.abbreviation
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by team' }), { target: { value: team } })
  expect(new URLSearchParams(window.location.search).get('team')).toBe(team)
  fireEvent.click(screen.getByRole('button', { name: 'Close calls' }))
  expect(new URLSearchParams(window.location.search).get('mode')).toBe('close')
  act(() => {
    window.history.replaceState(null, '', '/lab')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(screen.getByRole('combobox', { name: 'Filter by team' })).toHaveValue('')
  expect(screen.getByRole('button', { name: 'All games' })).toHaveAttribute('aria-pressed', 'true')
})

test('range coverage changes without changing the win forecast', () => {
  render(<Courtside initial={initial} />)
  const article = within(screen.getByRole('article', { name: 'Selected matchup' }))
  const probability = article.getByRole('img', { name: /%/ }).getAttribute('aria-label')
  fireEvent.click(article.getByRole('button', { name: '95%' }))
  expect(article.getByText(/Central 95%/)).toBeInTheDocument()
  expect(article.getByRole('img', { name: /%/ })).toHaveAttribute('aria-label', probability)
})
