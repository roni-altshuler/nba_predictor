import { render, screen } from '@testing-library/react'

import { BarLadder, type BarLadderRow } from '@/components/charts/BarLadder'
import { TeamExplorer } from '@/components/teams/TeamExplorer'
import type { PowerRating } from '@/lib/artifacts'
import { groupByDivision } from '@/lib/divisions'

const ROWS: BarLadderRow[] = [
  {
    key: '20', href: '/teams/NY', logo: null, abbreviation: 'NY',
    name: 'New York Knicks', label: 'NY', caption: '55.0 W · 100% playoffs',
    fill: 1, value: '29.1%', rank: 1,
  },
  {
    key: '24', href: '/teams/SA', logo: null, abbreviation: 'SA',
    name: 'San Antonio Spurs', label: 'SA', caption: '54.2 W · 99% playoffs',
    fill: 0.62, value: '18.1%', rank: 2,
  },
  {
    key: '0', logo: null, abbreviation: 'XXX', name: 'No page',
    label: 'XXX', fill: 2, value: '—',
  },
]

describe('BarLadder', () => {
  it('prints every value as text and scales the bar to the given share', () => {
    const { container } = render(<BarLadder rows={ROWS} ariaLabel="Title odds" />)
    expect(screen.getByText('29.1%')).toBeInTheDocument()
    expect(screen.getByText('18.1%')).toBeInTheDocument()
    expect(screen.getByText('55.0 W · 100% playoffs')).toBeInTheDocument()
    const fills = Array.from(container.querySelectorAll('[data-bar-fill]')).map(
      (el) => (el as HTMLElement).style.width,
    )
    // Clamped to the track: a share above one cannot draw past the edge.
    expect(fills).toEqual(['100%', '62%', '100%'])
  })

  it('only rows that go somewhere are links', () => {
    render(<BarLadder rows={ROWS} ariaLabel="Title odds" />)
    expect(screen.getByRole('link', { name: /New York Knicks/ })).toHaveAttribute(
      'href',
      '/teams/NY',
    )
    expect(screen.queryByRole('link', { name: /No page/ })).toBeNull()
    expect(screen.getByRole('list', { name: 'Title odds' })).toBeInTheDocument()
  })
})

const team = (
  team_id: number,
  abbreviation: string,
  conference: string,
  rank: number,
): PowerRating => ({
  rank, team_id, name: `${abbreviation} club`, abbreviation, conference,
  logo: null, elo: 1600 - rank,
})

describe('TeamExplorer', () => {
  it('groups conference → division and links every mark to its team page', () => {
    const rows = [
      { team: team(20, 'NY', 'Eastern Conference', 1), caption: '55–27' },
      { team: team(24, 'SA', 'Western Conference', 2), caption: '54–28' },
      { team: team(2, 'BOS', 'Eastern Conference', 3), caption: '50–32' },
      { team: team(99, 'ZZZ', 'Eastern Conference', 4), caption: '41–41' },
    ]
    render(<TeamExplorer rows={rows} />)
    // The accessible name is the mark's label, the code and the caption —
    // the content, not the title attribute.
    expect(screen.getByRole('link', { name: /NY club NY 55–27/ })).toHaveAttribute(
      'href',
      '/teams/NY',
    )
    const atlantic = screen.getByRole('list', { name: 'Atlantic' })
    expect(atlantic.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'Southwest' }).querySelectorAll('li')).toHaveLength(1)
    // An unknown code is shown under its conference, labelled, never dropped.
    expect(screen.getByRole('list', { name: 'Unassigned' }).querySelectorAll('li')).toHaveLength(1)
  })

  it('keeps input order inside a division and drops empty divisions', () => {
    const groups = groupByDivision(
      [team(24, 'SA', 'Western Conference', 1), team(11, 'HOU', 'Western Conference', 2)],
      (t) => t,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].short).toBe('West')
    expect(groups[0].divisions.map((d) => d.name)).toEqual(['Southwest'])
    expect(groups[0].divisions[0].items.map((t) => t.abbreviation)).toEqual(['SA', 'HOU'])
  })
})
