import { fireEvent, render, screen } from '@testing-library/react'
import { GameOutlook } from '@/components/forecast/GameOutlook'
import type { GameForecast } from '@/lib/artifacts'
import { pct } from '@/lib/format'
import openingSlate from '@/components/schedule/__tests__/fixtures/opening-slate.json'

const game = openingSlate[0] as GameForecast

test('leads with the published chance and estimated score, retaining exact metrics on demand', () => {
  const before = JSON.stringify(game)
  const view = render(<GameOutlook game={game}><a href="/predict">Explore this matchup</a></GameOutlook>)
  expect(screen.getByRole('heading', { name: `${game.home.name} favored` })).toBeInTheDocument()
  expect(screen.getByText(pct(game.p_home), { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('Projected score · not a result')).toBeInTheDocument()
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(screen.getByText(/Either team can win/)).toHaveTextContent('does not include injuries or confirmed lineups')
  fireEvent.click(screen.getByText('Prediction details', { selector: 'summary' }))
  expect(details.open).toBe(true)
  expect(screen.getByText('Proj. margin').nextElementSibling).toHaveTextContent(game.exp_margin.toFixed(1))
  expect(screen.getByRole('link', { name: 'Explore this matchup' })).toHaveAttribute('href', '/predict')
  expect(screen.getByText(/not an exact-score prediction/)).toBeInTheDocument()
  expect(JSON.stringify(game)).toBe(before)
})

test('orients an away favorite using the published away probability', () => {
  render(<GameOutlook game={{ ...game, p_home: .31, p_away: .69 }} />)
  expect(screen.getByRole('heading', { name: `${game.away.name} favored` })).toBeInTheDocument()
  expect(screen.getByText('69.0%', { selector: 'strong' })).toBeInTheDocument()
})

test('does not choose a winner for a published even matchup', () => {
  render(<GameOutlook game={{ ...game, p_home: .5, p_away: .5 }} />)
  expect(screen.getByRole('heading', { name: 'Evenly matched' })).toBeInTheDocument()
  expect(screen.getByText('50.0%', { selector: 'strong' }).parentElement).toHaveTextContent('chance each')
  expect(screen.queryByText(/favored/)).not.toBeInTheDocument()
})
