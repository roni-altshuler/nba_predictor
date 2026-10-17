import { render, screen } from '@testing-library/react'
import { latestCompletedGames, RecentGames } from '@/components/players/RecentGames'
import type { GameContext, Meeting } from '@/lib/history'
import type { PowerRating } from '@/lib/artifacts'

const meeting: Meeting = { id: '401859967', date: '2026-06-14T00:30:00Z', season: 2026, type: 3, away: 'NY', home: 'SA', away_score: 94, home_score: 90 }
const context = (rows: Meeting[]): GameContext => ({ generated_at: '2026-10-16T12:00:00Z', basis: 'archive', h2h_depth: 6, form_depth: 10, head_to_head: { 'NY:SA': rows }, form: {}, records: {} })

test('deduplicates actual final games, sorts by event date, and bounds the home list', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...meeting, id: String(401859960 + i), date: `2026-06-${10 + i}T00:30:00Z` }))
  const data = context([rows[0], rows[4], rows[1], rows[3], rows[2], rows[4]])
  const before = JSON.stringify(data)
  expect(latestCompletedGames(data).map(g => g.id)).toEqual(['401859964', '401859963', '401859962'])
  expect(JSON.stringify(data)).toBe(before)
})

test.each([null, context([])])('keeps unavailable archive coverage explicit: %p', data => {
  render(<RecentGames context={data} teams={[]} />)
  expect(screen.getByText(/Completed games are unavailable/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Browse completed seasons →' })).toHaveAttribute('href', '/seasons')
  expect(screen.queryByRole('link', { name: /final/ })).not.toBeInTheDocument()
})

test('shows dated, real final scores and a direct box-score route without inventing a player name', () => {
  render(<RecentGames context={context([meeting])} teams={[]} />)
  const link = screen.getByRole('link', { name: 'Final · Jun 13, 2026 NY 94 SA 90 Players & box score →' })
  expect(link).toHaveAttribute('href', '/games/401859967#player-box-scores')
  expect(link).toHaveAccessibleName('Final · Jun 13, 2026 NY 94 SA 90 Players & box score →')
  expect(screen.getByText(/Final · Jun 13, 2026/)).toBeInTheDocument()
  expect(screen.getByText(/when ESPN supplies them/)).toBeInTheDocument()
  expect(screen.queryByText(/Today|live|AI insight/i)).not.toBeInTheDocument()
})

test.each([false, true])('card computed names include the date, teams, scores and literal CTA once, with logos: %p', withLogos => {
  const teams = [{ abbreviation: 'NY', name: 'New York Knicks', logo: withLogos ? 'https://example.test/ny.png' : undefined },
    { abbreviation: 'SA', name: 'San Antonio Spurs', logo: withLogos ? 'https://example.test/sa.png' : undefined }] as PowerRating[]
  render(<RecentGames context={context([meeting])} teams={teams} />)
  const link = screen.getByRole('link', { name: 'Final · Jun 13, 2026 New York Knicks 94 San Antonio Spurs 90 Players & box score →' })
  expect(link).toHaveAccessibleName('Final · Jun 13, 2026 New York Knicks 94 San Antonio Spurs 90 Players & box score →')
  expect(link).not.toHaveAttribute('aria-label')
})

test('malformed or unfinished-looking results never become fabricated zero scores or player links', () => {
  const broken = [{ ...meeting, id: 'bad' }, { ...meeting, id: 123 }, { ...meeting, date: 'bad' }, { ...meeting, date: 2026 },
    { ...meeting, home_score: null }, { ...meeting, home_score: 94 }, { ...meeting, away_score: -1 }, { ...meeting, away: 'SA' }]
  expect(latestCompletedGames(context(broken as unknown as Meeting[]))).toEqual([])
})
