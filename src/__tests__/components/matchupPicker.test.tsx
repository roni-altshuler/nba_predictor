import { fireEvent, render, screen } from '@testing-library/react'

import { MatchupPicker, initialPair } from '@/app/(app)/predict/MatchupPicker'
import type { Matchups } from '@/lib/history'

let mockSearch = ''
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

const TEAMS: Matchups['teams'] = [
  { team_id: 1, name: 'Atlanta Hawks', abbreviation: 'ATL', conference: 'Eastern Conference', logo: null },
  { team_id: 2, name: 'Boston Celtics', abbreviation: 'BOS', conference: 'Eastern Conference', logo: null },
  { team_id: 20, name: 'New York Knicks', abbreviation: 'NY', conference: 'Eastern Conference', logo: null },
]

const matchups: Matchups['matchups'] = []
for (const home of TEAMS) {
  for (const away of TEAMS) {
    if (home === away) continue
    matchups.push({
      home: home.abbreviation, away: away.abbreviation,
      p_home: home.abbreviation === 'NY' ? 0.69 : 0.45,
      exp_margin: home.abbreviation === 'NY' ? 6.8 : -1.1,
      exp_total: 219.6, exp_home_score: 110.2, exp_away_score: 109.4,
    })
  }
}

const DATA: Matchups = {
  season: 2027,
  generated_at: '2026-09-12T10:00:00+00:00',
  teams: TEAMS,
  elo: { ATL: 1521, BOS: 1582, NY: 1674 },
  matchups,
  note: 'Rest-neutral: both sides are assumed rested.',
}

const homeSelect = () => screen.getByLabelText('Home team') as HTMLSelectElement
const awaySelect = () => screen.getByLabelText('Away team') as HTMLSelectElement

describe('initialPair', () => {
  it('takes ?home=&away= in any case', () => {
    expect(initialPair(TEAMS, 'ny', 'bos')).toEqual({ home: 'NY', away: 'BOS' })
  })
  it('falls back for an unknown code, and never pairs a team with itself', () => {
    expect(initialPair(TEAMS, 'SEA', null)).toEqual({ home: 'ATL', away: 'BOS' })
    expect(initialPair(TEAMS, 'BOS', 'BOS')).toEqual({ home: 'BOS', away: 'ATL' })
  })
})

describe('MatchupPicker deep links', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/predict')
  })

  it('initialises from the query string', () => {
    mockSearch = 'home=NY&away=BOS'
    render(<MatchupPicker data={DATA} />)
    expect(homeSelect().value).toBe('NY')
    expect(awaySelect().value).toBe('BOS')
    // The published probability for that ordered pairing, as text.
    expect(screen.getByText('69.0%')).toBeInTheDocument()
  })

  it('opens on the first two teams when the URL says nothing', () => {
    mockSearch = ''
    render(<MatchupPicker data={DATA} />)
    expect(homeSelect().value).toBe('ATL')
    expect(awaySelect().value).toBe('BOS')
  })

  it('writes the pairing to the address bar on every change', () => {
    mockSearch = ''
    render(<MatchupPicker data={DATA} />)
    fireEvent.change(awaySelect(), { target: { value: 'NY' } })
    expect(window.location.search).toBe('?home=ATL&away=NY')
    fireEvent.click(screen.getByRole('button', { name: /swap/i }))
    expect(window.location.search).toBe('?home=NY&away=ATL')
    expect(homeSelect().value).toBe('NY')
  })
})
