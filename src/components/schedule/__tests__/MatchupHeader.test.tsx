import { fireEvent, render, screen } from '@testing-library/react'

import type { GameForecast } from '@/lib/artifacts'
import { stamp } from '@/lib/format'
import { MatchupHeader } from '../MatchupHeader'
import { MatchupSections } from '../MatchupSections'
import openingSlate from './fixtures/opening-slate.json'

jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn() }) }))

const game = openingSlate[2] as GameForecast

beforeEach(() => {
  window.history.replaceState({ marker: 'next-state' }, '', `/games/${game.game_id}?source=slate`)
  window.sessionStorage.clear()
})

test('renders one matchup with scalar forecast timing and the correct Eastern parent', () => {
  const generatedAt = '2026-10-06T06:20:00Z'
  const trainedThrough = '2026-06-15T01:00:00Z'
  render(<MatchupHeader game={game} generatedAt={generatedAt} trainedThrough={trainedThrough}
    records={{ home: '2025–26 · 62–20', away: '2025–26 · 64–18' }} />)
  expect(screen.getByRole('heading', { name: `${game.away.name} at ${game.home.name}` })).toBeInTheDocument()
  expect(screen.getByText(stamp(generatedAt))).toBeInTheDocument()
  expect(screen.getByText(stamp(trainedThrough))).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Daily slate' })).toHaveAttribute('href', '/games?date=2026-10-20')
  expect(screen.getByText('2025–26 · 62–20')).toBeInTheDocument()
  const timing = screen.getByText('Win chances & forecast timing').closest('details')!
  expect(timing.open).toBe(false)
  fireEvent.click(screen.getByText('Win chances & forecast timing'))
  expect(timing.open).toBe(true)
  expect(screen.getByRole('img', { name: /OKC 41.5%, SA 58.5%/ })).toBeInTheDocument()
})

test('section navigation opens collapsed ancestors without losing return history or query state', () => {
  render(<><MatchupSections /><details data-testid="outer"><summary>More</summary><section id="shooting-context">Team data</section></details></>)
  const target = document.getElementById('shooting-context')!
  target.scrollIntoView = jest.fn()
  const entries = window.history.length
  fireEvent.click(screen.getByRole('link', { name: 'Team trends' }))
  expect(screen.getByTestId('outer')).toHaveAttribute('open')
  expect(document.activeElement).toBe(target)
  expect(window.history.length).toBe(entries)
  expect(window.history.state).toEqual({ marker: 'next-state' })
  expect(window.location.search).toBe('?source=slate')
})

test('an intentional prediction-detail deep link opens and focuses its disclosure on arrival', () => {
  window.history.replaceState({ marker: 'next-state' }, '', '/games/401909088?source=slate#prediction-details')
  const scroll = jest.fn()
  const ref = (node: HTMLDetailsElement | null) => { if (node) node.scrollIntoView = scroll }
  render(<><MatchupSections /><details id="prediction-details" ref={ref}><summary>Prediction details</summary>Published numbers</details></>)
  expect(document.getElementById('prediction-details')).toHaveAttribute('open')
  expect(document.activeElement).toBe(document.getElementById('prediction-details'))
  expect(scroll).toHaveBeenCalledTimes(1)
})

test('the played-game navigation leads directly to player box scores', () => {
  render(<><MatchupSections mode="played" /><div id="player-box-scores">Players</div></>)
  const target = document.getElementById('player-box-scores')!; target.scrollIntoView = jest.fn()
  fireEvent.click(screen.getByRole('link', { name: 'Players & box score' }))
  expect(document.activeElement).toBe(target)
  expect(window.location.hash).toBe('#player-box-scores')
})

test('a shared player-comparison deep link reveals its new optional disclosure', () => {
  window.history.replaceState({ marker: 'next-state' }, '', '/games/401859967?compareLeft=espn-900000001#game-line-comparison')
  const ref = (node: HTMLElement | null) => { if (node) node.scrollIntoView = jest.fn() }
  render(<><MatchupSections mode="played" /><details data-testid="comparison"><summary>Compare player lines</summary><section id="game-line-comparison" ref={ref}>Reported lines</section></details></>)
  expect(screen.getByTestId('comparison')).toHaveAttribute('open')
  expect(document.activeElement).toBe(document.getElementById('game-line-comparison'))
  expect(window.location.search).toBe('?compareLeft=espn-900000001')
})

test('keeps an absent results cutoff explicit', () => {
  render(<MatchupHeader game={game} generatedAt="2026-10-06T06:20:00Z" trainedThrough={null} records={{}} />)
  expect(screen.getByText('Results used through').nextElementSibling).toHaveTextContent('unknown')
  expect(screen.getAllByText('Record unavailable')).toHaveLength(2)
})

test.each([
  ['Prediction', 'forecast'],
  ['Odds', 'market'],
  ['Availability', 'availability'],
  ['Meetings', 'context'],
])('section %s focuses its target while preserving the return history', (label, id) => {
  render(<><MatchupSections /><section id={id}>Section content</section></>)
  const target = document.getElementById(id)!
  target.scrollIntoView = jest.fn()
  const entries = window.history.length
  fireEvent.click(screen.getByRole('link', { name: label }))
  expect(document.activeElement).toBe(target)
  expect(target.scrollIntoView).toHaveBeenCalledTimes(1)
  expect(window.location.hash).toBe(`#${id}`)
  expect(window.location.search).toBe('?source=slate')
  expect(window.history.length).toBe(entries)
  expect(window.history.state).toEqual({ marker: 'next-state' })
})
