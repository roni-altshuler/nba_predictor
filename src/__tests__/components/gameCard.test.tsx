import { render, screen } from '@testing-library/react'

import { GameCard } from '@/components/forecast/GameCard'
import { EvidencePanel } from '@/components/evidence/EvidencePanel'
import type { GameForecast, MeasuredBlock } from '@/lib/artifacts'

const BASE: GameForecast = {
  game_id: '1',
  date_utc: '2026-10-20T23:00:00+00:00',
  venue: 'TD Garden',
  neutral_site: false,
  home: {
    team_id: 2, name: 'Boston Celtics', abbreviation: 'BOS',
    conference: 'Eastern Conference', logo: null, elo: 1582,
  },
  away: {
    team_id: 8, name: 'Detroit Pistons', abbreviation: 'DET',
    conference: 'Eastern Conference', logo: null, elo: 1588,
  },
  p_home: 0.571,
  p_away: 0.429,
  exp_margin: 2.8,
  exp_total: 217.4,
  exp_home_score: 110.1,
  exp_away_score: 107.3,
  margin_sd: 13.1,
  total_sd: 20.4,
}

describe('GameCard', () => {
  it('renders both probabilities as text, not only as a bar', () => {
    // Colour alone never carries a number on this site: a reader cannot read
    // 57% off a bar and a colour-blind reader cannot read it off a hue.
    render(<GameCard game={BASE} />)
    expect(screen.getByText('57.1%')).toBeInTheDocument()
    expect(screen.getByText('42.9%')).toBeInTheDocument()
  })

  it('reads "vs" before tip-off rather than a pair of dashes', () => {
    // Two dashes where a scoreline belongs reads as data that failed to load.
    render(<GameCard game={BASE} />)
    const marker = screen.getByText('vs')
    expect(marker).toHaveAttribute('data-score', 'pending')
  })

  it('says a market is MISSING rather than showing a zero edge', () => {
    // "No line published" and "no edge" are different facts, and a card that
    // renders them identically is lying about one of them.
    render(<GameCard game={BASE} />)
    expect(
      screen.getByText(/No sportsbook line published/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/^EV/)).not.toBeInTheDocument()
  })

  it('shows the value surface when a price exists', () => {
    render(
      <GameCard
        game={{
          ...BASE,
          value: {
            ml_home: -140, ml_away: 120, fair_home: 0.573, fair_away: 0.427,
            overround: 0.041, spread_home: -3.5, total_points: 218.5,
            edge_home: -0.002, edge_away: 0.002, best_side: 'away',
            edge: 0.002, expected_value: 0.004, kelly: 0.0,
            flagged: false, min_edge: 0.02,
          },
        }}
      />,
    )
    // Away first, matching the card's away-at-home layout. The order is
    // part of the contract: a reader scanning the ML row and the team row
    // must find the same side in the same place.
    expect(screen.getByText('+120 / -140')).toBeInTheDocument()
    expect(screen.getByText('-3.5')).toBeInTheDocument()
  })

  it('explains why a small edge is not called value', () => {
    // The flag is gated on the edge clearing our own measured calibration
    // error. Below that, "value" is indistinguishable from being slightly
    // miscalibrated — and the card must say so rather than stay silent.
    render(
      <GameCard
        game={{
          ...BASE,
          value: {
            ml_home: -140, ml_away: 120, fair_home: 0.573, fair_away: 0.427,
            overround: 0.041, spread_home: -3.5, total_points: 218.5,
            edge_home: 0.005, edge_away: -0.005, best_side: 'home',
            edge: 0.005, expected_value: 0.01, kelly: 0.0,
            flagged: false, min_edge: 0.02,
          },
        }}
      />,
    )
    expect(screen.getByText(/edge below the 2% floor/i)).toBeInTheDocument()
  })

  it('flags a genuine edge', () => {
    render(
      <GameCard
        game={{
          ...BASE,
          value: {
            ml_home: -110, ml_away: -110, fair_home: 0.5, fair_away: 0.5,
            overround: 0.048, spread_home: -1.5, total_points: 218.5,
            edge_home: 0.071, edge_away: -0.071, best_side: 'home',
            edge: 0.071, expected_value: 0.09, kelly: 0.02,
            flagged: true, min_edge: 0.02,
          },
        }}
      />,
    )
    expect(screen.getByText(/Edge 7\.1%/)).toBeInTheDocument()
  })
})

describe('EvidencePanel', () => {
  const MEASURED: MeasuredBlock = {
    available: true,
    generated_at: '2026-08-15T16:19:52+00:00',
    walk_forward_n: 25749,
    walk_forward_brier: 0.2106,
    walk_forward_ece: 0.0114,
    paired_n: 14600,
    market_brier: 0.207,
    model_brier: 0.2141,
    gap_to_market: 0.00712,
    bootstrap: {
      mean_diff: 0.00712, ci_low: 0.00573, ci_high: 0.00849, p_a_better: 0,
    },
    basis: 'historical walk-forward; not a live published record',
  }

  it('states the gap to the market rather than a bare accuracy', () => {
    render(<EvidencePanel measured={MEASURED} />)
    expect(screen.getByText('0.2070')).toBeInTheDocument()
    expect(screen.getByText('+0.0071')).toBeInTheDocument()
  })

  it('labels the basis so historical is never read as live', () => {
    render(<EvidencePanel measured={MEASURED} />)
    expect(
      screen.getByText(/not a live published record/i),
    ).toBeInTheDocument()
  })

  it('says so when there is no benchmark, instead of rendering blanks', () => {
    render(<EvidencePanel measured={{ available: false, reason: 'not run' }} />)
    expect(screen.getByText(/No benchmark has been published/i)).toBeInTheDocument()
    expect(screen.getByText(/treat every probability/i)).toBeInTheDocument()
  })

  it('handles a completely absent measured block', () => {
    render(<EvidencePanel measured={undefined} />)
    expect(screen.getByText(/No benchmark has been published/i)).toBeInTheDocument()
  })
})
