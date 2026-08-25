import { fireEvent, render, screen } from '@testing-library/react'

import {
  cycleSeasonSort,
  SeasonTable,
  sortSeasonRows,
  type SeasonRow,
} from '@/components/accuracy/SeasonTable'
import { RatingsTable } from '@/components/ratings/RatingsTable'
import type { PowerRating } from '@/lib/artifacts'

/**
 * The two sortable tables share one contract: sorting is a view, never a
 * recomputation, headers are real buttons so the keyboard gets them for
 * free, the active column carries `aria-sort`, and a third click restores
 * the default order rather than leaving the reader stranded in a sort they
 * cannot undo. The ratings table's default IS the published order (rating
 * descending); the season table's default reverses the published
 * chronology, newest season first.
 */

const TEAMS: PowerRating[] = [
  {
    rank: 1, team_id: 2, name: 'Boston Celtics', abbreviation: 'BOS',
    conference: 'Eastern Conference', logo: null, elo: 1650,
  },
  {
    rank: 2, team_id: 21, name: 'Oklahoma City Thunder', abbreviation: 'OKC',
    conference: 'Western Conference', logo: null, elo: 1640,
  },
  {
    rank: 3, team_id: 5, name: 'Cleveland Cavaliers', abbreviation: 'CLE',
    conference: 'Eastern Conference', logo: null, elo: 1600,
  },
]

function rowNames(container: HTMLElement): string[] {
  // The name span, not the whole cell — a logo-less TeamLogo falls back to
  // the abbreviation, which is part of the cell's text but not the name.
  return Array.from(
    container.querySelectorAll('tbody tr td:nth-child(2) .truncate'),
  ).map((cell) => cell.textContent ?? '')
}

describe('RatingsTable sorting', () => {
  it('renders the published order and marks the rating column sorted', () => {
    const { container } = render(<RatingsTable teams={TEAMS} />)
    expect(rowNames(container)).toEqual([
      'Boston Celtics',
      'Oklahoma City Thunder',
      'Cleveland Cavaliers',
    ])
    // The initial state IS a sort — rating descending — and aria-sort says
    // so instead of pretending the table is unordered.
    expect(
      screen.getByRole('columnheader', { name: /elo/i }),
    ).toHaveAttribute('aria-sort', 'descending')
    expect(
      screen.getByRole('columnheader', { name: /^team$/i }),
    ).not.toHaveAttribute('aria-sort')
  })

  it('headers are real buttons, so Enter and Space work natively', () => {
    render(<RatingsTable teams={TEAMS} />)
    for (const name of [/^team$/i, /conference/i, /^elo/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // The rank and bar columns are not sorts of anything: no buttons there.
    expect(
      screen.getByRole('columnheader', { name: /relative/i }).querySelector('button'),
    ).toBeNull()
  })

  it('sorts by team name ascending, then descending, then restores', () => {
    const { container } = render(<RatingsTable teams={TEAMS} />)
    const teamButton = screen.getByRole('button', { name: /^team/i })

    fireEvent.click(teamButton)
    expect(rowNames(container)).toEqual([
      'Boston Celtics',
      'Cleveland Cavaliers',
      'Oklahoma City Thunder',
    ])
    expect(
      screen.getByRole('columnheader', { name: /^team/i }),
    ).toHaveAttribute('aria-sort', 'ascending')
    // The rating column hands its indicator over.
    expect(
      screen.getByRole('columnheader', { name: /^elo/i }),
    ).not.toHaveAttribute('aria-sort')

    fireEvent.click(teamButton)
    expect(rowNames(container)).toEqual([
      'Oklahoma City Thunder',
      'Cleveland Cavaliers',
      'Boston Celtics',
    ])
    expect(
      screen.getByRole('columnheader', { name: /^team/i }),
    ).toHaveAttribute('aria-sort', 'descending')

    // Third click: back to the published order, rating column marked again.
    fireEvent.click(teamButton)
    expect(rowNames(container)).toEqual([
      'Boston Celtics',
      'Oklahoma City Thunder',
      'Cleveland Cavaliers',
    ])
    expect(
      screen.getByRole('columnheader', { name: /^elo/i }),
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('flips the rating column and comes back to the published order', () => {
    const { container } = render(<RatingsTable teams={TEAMS} />)
    const eloButton = screen.getByRole('button', { name: /^elo/i })

    // Already descending, so the first click flips to ascending…
    fireEvent.click(eloButton)
    expect(rowNames(container)).toEqual([
      'Cleveland Cavaliers',
      'Oklahoma City Thunder',
      'Boston Celtics',
    ])
    expect(
      screen.getByRole('columnheader', { name: /^elo/i }),
    ).toHaveAttribute('aria-sort', 'ascending')

    // …and the second restores the default, which is descending again.
    fireEvent.click(eloButton)
    expect(rowNames(container)).toEqual([
      'Boston Celtics',
      'Oklahoma City Thunder',
      'Cleveland Cavaliers',
    ])
    expect(
      screen.getByRole('columnheader', { name: /^elo/i }),
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('keeps each team’s published rank whatever the sort', () => {
    const { container } = render(<RatingsTable teams={TEAMS} />)
    fireEvent.click(screen.getByRole('button', { name: /^team/i }))
    const ranks = Array.from(
      container.querySelectorAll('tbody tr td:first-child'),
    ).map((cell) => cell.textContent)
    // Alphabetical order is BOS(1), CLE(3), OKC(2) — rank travels with the
    // team because it is a fact about the team, not about the row.
    expect(ranks).toEqual(['1', '3', '2'])
  })

  it('keeps team names as links to their team page', () => {
    render(<RatingsTable teams={TEAMS} />)
    expect(
      screen.getByRole('link', { name: /boston celtics/i }),
    ).toHaveAttribute('href', '/teams/BOS')
  })
})

describe('Season table sort logic', () => {
  const ROWS: SeasonRow[] = [
    { season: 2007, n: 1309, modelBrier: 0.2187, marketBrier: null, gap: null },
    { season: 2016, n: 1316, modelBrier: 0.209, marketBrier: 0.2051, gap: 0.0039 },
    { season: 2026, n: 1322, modelBrier: 0.2069, marketBrier: 0.1991, gap: 0.0092 },
  ]

  it('null means the default view: season descending, newest first', () => {
    expect(sortSeasonRows(ROWS, null).map((r) => r.season)).toEqual([
      2026, 2016, 2007,
    ])
  })

  it('renders newest season first and marks the season column on load', () => {
    const { container } = render(<SeasonTable rows={ROWS} />)
    const seasons = Array.from(
      container.querySelectorAll('tbody tr td:first-child'),
    ).map((cell) => cell.textContent)
    expect(seasons).toEqual(['2025–26', '2015–16', '2006–07'])
    expect(
      screen.getByRole('columnheader', { name: /season/i }),
    ).toHaveAttribute('aria-sort', 'descending')
  })

  it('a season with no market sorts last in BOTH directions', () => {
    // "No line published" is not a very small Brier: 2007 must not float to
    // the top when sorting the market column ascending.
    const asc = sortSeasonRows(ROWS, { key: 'marketBrier', dir: 'asc' })
    expect(asc.map((r) => r.season)).toEqual([2026, 2016, 2007])
    const desc = sortSeasonRows(ROWS, { key: 'marketBrier', dir: 'desc' })
    expect(desc.map((r) => r.season)).toEqual([2016, 2026, 2007])
  })

  it('cycles: sort, flip, restore published order', () => {
    const first = cycleSeasonSort(null, 'modelBrier')
    expect(first).toEqual({ key: 'modelBrier', dir: 'asc' })
    const second = cycleSeasonSort(first, 'modelBrier')
    expect(second).toEqual({ key: 'modelBrier', dir: 'desc' })
    expect(cycleSeasonSort(second, 'modelBrier')).toBeNull()
  })

  it('the season column two-cycles, because the default IS season descending', () => {
    const flipped = cycleSeasonSort(null, 'season')
    expect(flipped).toEqual({ key: 'season', dir: 'asc' })
    expect(cycleSeasonSort(flipped, 'season')).toBeNull()
  })

  it('switching columns starts that column’s own first direction', () => {
    const onBrier = cycleSeasonSort({ key: 'season', dir: 'desc' }, 'n')
    expect(onBrier).toEqual({ key: 'n', dir: 'desc' })
  })
})
