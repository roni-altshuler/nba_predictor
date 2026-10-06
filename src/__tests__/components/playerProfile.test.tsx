import { fireEvent, render, screen } from '@testing-library/react'
import { AthletePortrait } from '@/components/players/AthletePortrait'
import { PlayerName } from '@/components/players/PlayerName'
import { PlayerBoxScores } from '@/components/players/PlayerBoxScores'
import { PlayerProfileView } from '@/components/players/PlayerProfileView'
import PlayerLoading from '@/app/(app)/players/[provider]/[id]/loading'
import type { AthleteImageAsset } from '@/lib/athleteIdentity'
import type { PlayerProfile } from '@/lib/playerProfile'

jest.mock('next/navigation', () => ({ useRouter: () => ({ back: jest.fn() }) }))
const identity = { provider: 'espn', id: '900000001' } as const
const available: PlayerProfile = {
  identity, status: 'available',
  game: { id: '401859967', date: '2026-06-14T00:30:00Z', away: 'NY', home: 'SA', awayScore: 94, homeScore: 90, archivePublishedAt: '2026-10-05T19:33:25Z', team: { id: '18', gameReportedName: 'New York Knicks', franchise: { abbreviation: 'NY', name: 'New York Knicks', href: '/teams/NY' } } },
  labels: ['PTS', 'REB', 'AST', 'FG'],
  player: { id: identity.id, provider: 'espn', name: 'QA Guard', shortName: 'Q. Guard', jersey: '11', position: 'G', starter: true, didNotPlay: false, reason: null, stats: { PTS: '29', REB: '0', FG: '10-22' } },
}

test('renders a name, one game line, missing cells and explicit broader coverage', () => {
  render(<PlayerProfileView profile={available} />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('QA Guard')
  expect(screen.getByText('29')).toBeInTheDocument()
  expect(screen.getByText('0', { exact: true })).toBeInTheDocument()
  expect(screen.getAllByText('—').length).toBe(2)
  expect(screen.getAllByText('Unavailable')).toHaveLength(3)
  expect(screen.getByText(/Source update time unavailable/)).toBeInTheDocument()
  expect(screen.getByText(/Results archive published Oct 5, 2026/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Game box score' })).toHaveAttribute('href', '/games/401859967#player-box-scores')
  expect(document.querySelector('img')).toBeNull()
})

test('a missing box score never pretends to identify a player', () => {
  render(<PlayerProfileView profile={{ identity, status: 'unavailable', reason: 'box_score_unavailable', game: { ...available.game!, team: { ...available.game!.team, gameReportedName: null } } }} />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Player profile unavailable')
  expect(screen.getByRole('status')).toHaveTextContent('ESPN player box score is unavailable')
  expect(screen.queryByText('QA Guard')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Return to the game →' })).toHaveAttribute('href', '/games/401859967#player-box-scores')
})

test('DNP retains identity and reason without a statistics panel', () => {
  render(<PlayerProfileView profile={{ ...available, player: { ...available.player, didNotPlay: true, reason: 'DNP-COACH DECISION', stats: {} } }} />)
  expect(screen.getByText('DNP-COACH DECISION')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Single-game statistics' })).not.toBeInTheDocument()
})

test('links both leaders and box-score names to the same provider-qualified profile', () => {
  render(<PlayerBoxScores box={{ gameId: '401859967', teams: [{ teamId: '18', abbreviation: 'NY', displayName: 'New York Knicks', logo: null, labels: available.labels, players: [available.player], totals: {}, leaders: [{ label: 'Points', player: 'Q. Guard', fullName: available.player.name, identity, value: '29' }] }] }} />)
  const links = screen.getAllByRole('link', { name: 'QA Guard' })
  expect(links).toHaveLength(2)
  links.forEach(link => expect(link).toHaveAttribute('href', '/players/espn/900000001?game=401859967&team=18'))
})

test('keeps unknown IDs visible without making guessed links', () => {
  render(<PlayerName identity={null} gameId="401859967" teamId="18" name="Visible Name" />)
  expect(screen.getByText('Visible Name')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

test('a previously permitted image falls back cleanly if it cannot load', () => {
  const asset: AthleteImageAsset = { provider: 'espn', subject: identity, src: '/athletes/test.webp', provenance: { sourceUrl: 'https://www.espn.com/test', verifiedAt: '2026-10-06T00:00:00Z' }, permission: { status: 'permitted', basis: 'Fixture permission', reference: 'fixture', verifiedAt: '2026-10-06T00:00:00Z' } }
  const { container } = render(<AthletePortrait identity={identity} name="QA Guard" jersey="11" asset={asset} />)
  const img = container.querySelector('img')!
  fireEvent.error(img)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('QG')).toBeInTheDocument()
  expect(screen.getByText('#11')).toBeInTheDocument()
})

test('announces player loading without invented values', () => {
  render(<PlayerLoading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading player game line…')
  expect(screen.getByLabelText('Loading player profile')).toHaveAttribute('aria-busy', 'true')
})

test.each([
  { id: '25', reported: 'Seattle SuperSonics', normalized: 'Oklahoma City Thunder', abbreviation: 'OKC' },
  { id: '17', reported: 'New Jersey Nets', normalized: 'Brooklyn Nets', abbreviation: 'BKN' },
  { id: '3', reported: 'New Orleans Hornets', normalized: 'New Orleans Pelicans', abbreviation: 'NO' },
])('labels the game-reported $reported separately from the franchise reference', ({ id, reported, normalized, abbreviation }) => {
  render(<PlayerProfileView profile={{ ...available, game: { ...available.game!, date: '2003-10-31T00:30:00Z', team: { id, gameReportedName: reported, franchise: { name: normalized, abbreviation, href: `/teams/${abbreviation}` } } } }} />)
  expect(screen.getByText(`Game-reported team · ${reported}`)).toBeInTheDocument()
  expect(screen.getByText(/^Franchise reference ·/)).toHaveTextContent(normalized)
  expect(screen.getByRole('link', { name: normalized })).toHaveAttribute('href', `/teams/${abbreviation}`)
  expect(screen.getByText(/^Game-reported team/)).not.toHaveTextContent(normalized)
  expect(screen.getByText('Score matchup uses normalized franchise codes.')).toBeInTheDocument()
})

test('an unavailable game name stays unavailable beside a labeled modern franchise reference', () => {
  render(<PlayerProfileView profile={{ ...available, game: { ...available.game!, team: { id: '25', gameReportedName: null, franchise: { name: 'Oklahoma City Thunder', abbreviation: 'OKC', href: '/teams/OKC' } } } }} />)
  expect(screen.getByText('Game-reported team · Unavailable')).toBeInTheDocument()
  expect(screen.getByText(/^Game-reported team/)).not.toHaveTextContent('Oklahoma City Thunder')
  expect(screen.getByText(/^Franchise reference ·/)).toHaveTextContent('Oklahoma City Thunder')
})
