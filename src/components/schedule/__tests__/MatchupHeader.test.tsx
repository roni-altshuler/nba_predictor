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
  expect(screen.getByRole('img', { name: /OKC 41.5%, SA 58.5%/ })).toBeInTheDocument()
})

test('keeps an absent results cutoff explicit', () => {
  render(<MatchupHeader game={game} generatedAt="2026-10-06T06:20:00Z" trainedThrough={null} records={{}} />)
  expect(screen.getByText('Results used through').nextElementSibling).toHaveTextContent('unknown')
  expect(screen.getAllByText('Record unavailable')).toHaveLength(2)
})

test.each([
  ['Projection', 'forecast'],
  ['Market', 'market'],
  ['Availability', 'availability'],
  ['Recent meetings', 'context'],
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
