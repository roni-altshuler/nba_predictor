/** Synthetic lines test boundaries; they are never published player coverage. */
import { getPlayerProfile } from '@/lib/playerProfile'
import fs from 'node:fs'
import path from 'node:path'
import { playerGameHref } from '@/lib/athleteIdentity'
import { getEspnBoxScore, type GameBoxScore } from '@/lib/espn'
import { getAllStarEvent, getArchivedGame, type SeasonFile } from '@/lib/history'

jest.mock('@/lib/espn', () => ({ getEspnBoxScore: jest.fn() }))
jest.mock('@/lib/artifacts', () => ({ getPowerRatings: () => ({ teams: [{ team_id: 20, abbreviation: 'NY' }] }) }))
jest.mock('@/lib/history', () => ({ getArchivedGame: jest.fn(), getAllStarEvent: jest.fn(), getSeasonsIndex: () => ({ generated_at: '2026-10-05T19:33:25Z' }) }))

const identity = { provider: 'espn', id: '900000001' } as const
const archive = {
  game: { id: '401859967', home_id: 27, away_id: 20, home: 'SA', away: 'NY', date: '2026-06-14T00:30:00Z', home_score: 90, away_score: 94 },
  season: { standings: [{ team_id: 20, espn_id: '18', abbreviation: 'NY', name: 'New York Knicks' }, { team_id: 27, espn_id: '24', abbreviation: 'SA', name: 'San Antonio Spurs' }] },
}
const box: GameBoxScore = {
  gameId: '401859967', teams: [{ teamId: '18', abbreviation: 'NY', displayName: 'New York Knicks', logo: null, labels: ['PTS', 'REB'], totals: {}, leaders: [], players: [{ id: identity.id, provider: 'espn', name: 'QA Guard', shortName: 'Q. Guard', position: 'G', jersey: '11', starter: true, didNotPlay: false, reason: null, stats: { PTS: '29' } }] }],
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getArchivedGame).mockReturnValue(archive as ReturnType<typeof getArchivedGame>)
  jest.mocked(getAllStarEvent).mockReturnValue(null)
  jest.mocked(getEspnBoxScore).mockResolvedValue(box)
})

test('uses the recorded ESPN team mapping, not the internal warehouse number', async () => {
  const profile = await getPlayerProfile(identity, '401859967', '18')
  expect(profile).toMatchObject({ status: 'available', player: { name: 'QA Guard', stats: { PTS: '29' } }, game: { team: { id: '18', gameReportedName: 'New York Knicks', franchise: { name: 'New York Knicks', href: '/teams/NY' } }, archivePublishedAt: '2026-10-05T19:33:25Z' } })
  expect(profile).not.toHaveProperty('seasonAverages')
  expect(await getPlayerProfile(identity, '401859967', '20')).toMatchObject({ status: 'unavailable', reason: 'team_not_in_game' })
  expect(getEspnBoxScore).toHaveBeenCalledTimes(1)
})

test('rejects NBA identity and unknown context before any external request', async () => {
  expect(await getPlayerProfile({ provider: 'nba', id: identity.id }, '401859967', '18')).toMatchObject({ reason: 'context_required' })
  expect(await getPlayerProfile(identity, null, '18')).toMatchObject({ reason: 'context_required' })
  jest.mocked(getArchivedGame).mockReturnValue(null)
  expect(await getPlayerProfile(identity, '111', '18')).toMatchObject({ reason: 'game_not_published' })
  expect(getEspnBoxScore).not.toHaveBeenCalled()
})

test('requires the archive provider mapping and refuses exhibition warehouse IDs', async () => {
  const withoutMapping = { ...archive, season: { standings: archive.season.standings.map(t => ({ ...t, espn_id: undefined })) } }
  jest.mocked(getArchivedGame).mockReturnValue(withoutMapping as ReturnType<typeof getArchivedGame>)
  expect(await getPlayerProfile(identity, '401859967', '20')).toMatchObject({ reason: 'team_mapping_unavailable' })
  jest.mocked(getArchivedGame).mockReturnValue(null)
  jest.mocked(getAllStarEvent).mockReturnValue({ id: '111' } as NonNullable<ReturnType<typeof getAllStarEvent>>)
  expect(await getPlayerProfile(identity, '111', '87')).toMatchObject({ reason: 'team_mapping_unavailable' })
  expect(getEspnBoxScore).not.toHaveBeenCalled()
})

test('an upstream failure retains the verified game, but no invented player', async () => {
  jest.mocked(getEspnBoxScore).mockResolvedValue(null)
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ status: 'unavailable', reason: 'box_score_unavailable', game: { id: '401859967', team: { id: '18', gameReportedName: null, franchise: { name: 'New York Knicks' } } } })
})

test('never resolves a same-number NBA line or a player in the other team', async () => {
  const wrongProvider = { ...box, teams: [{ ...box.teams[0], players: [{ ...box.teams[0].players[0], provider: 'nba' }] }] }
  jest.mocked(getEspnBoxScore).mockResolvedValue(wrongProvider as GameBoxScore)
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ reason: 'player_not_in_game' })
  jest.mocked(getEspnBoxScore).mockResolvedValue({ ...box, teams: [{ ...box.teams[0], teamId: '24' }] })
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ reason: 'player_not_in_game' })
})

test('retains a DNP reason and missing cells without creating zero stats', async () => {
  jest.mocked(getEspnBoxScore).mockResolvedValue({ ...box, teams: [{ ...box.teams[0], players: [{ ...box.teams[0].players[0], didNotPlay: true, reason: 'DNP', stats: {} }] }] })
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ status: 'available', player: { didNotPlay: true, reason: 'DNP', stats: {} } })
})

const historicalFranchises = [
  { espnId: '25', reportedName: 'Seattle SuperSonics', normalizedName: 'Oklahoma City Thunder' },
  { espnId: '17', reportedName: 'New Jersey Nets', normalizedName: 'Brooklyn Nets' },
  { espnId: '3', reportedName: 'New Orleans Hornets', normalizedName: 'New Orleans Pelicans' },
]
const historicalCases = [2004, 2005].flatMap(season => historicalFranchises.map(team => ({ ...team, season })))

test.each(historicalCases)('separates the supplied game name from the normalized $normalizedName in season $season', async ({ espnId, reportedName, normalizedName, season: year }) => {
  // Real committed 2003/2004 results and provider mappings; synthetic player
  // lines/name responses exercise the boundary without fetching a new dataset.
  const season = JSON.parse(fs.readFileSync(path.join(process.cwd(), `backend/data/history/season_${year}.json`), 'utf8')) as SeasonFile
  const franchise = season.standings.find(t => t.espn_id === espnId)!
  const game = season.games.find(g => [g.home_id, g.away_id].includes(franchise.team_id))!
  expect(game.date).toMatch(new RegExp(`^${year - 1}-`))
  expect(franchise.name).toBe(normalizedName)
  jest.mocked(getArchivedGame).mockReturnValue({ game, season })
  jest.mocked(getEspnBoxScore).mockResolvedValue({ ...box, gameId: game.id, teams: [{ ...box.teams[0], teamId: espnId, displayName: reportedName }] })
  const profile = await getPlayerProfile(identity, game.id, espnId)
  expect(profile).toMatchObject({ status: 'available', game: { team: { id: espnId, gameReportedName: reportedName, franchise: { name: normalizedName } } } })
  expect(playerGameHref(profile.identity, profile.game!.id, profile.game!.team.id)).toBe(`/players/espn/900000001?game=${game.id}&team=${espnId}`)
})

test.each([null, '', '   '])('a missing game-reported name (%s) never falls back to the normalized franchise name', async displayName => {
  jest.mocked(getEspnBoxScore).mockResolvedValue({ ...box, teams: [{ ...box.teams[0], displayName }] })
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ status: 'available', game: { team: { gameReportedName: null, franchise: { name: 'New York Knicks' } } } })
})

test('a mismatched summary or team cannot supply the game-reported name', async () => {
  jest.mocked(getEspnBoxScore).mockResolvedValue({ ...box, gameId: '999' })
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ reason: 'box_score_unavailable', game: { team: { gameReportedName: null } } })
  jest.mocked(getEspnBoxScore).mockResolvedValue({ ...box, teams: [{ ...box.teams[0], teamId: '24', displayName: 'Wrong team' }] })
  expect(await getPlayerProfile(identity, '401859967', '18')).toMatchObject({ reason: 'player_not_in_game', game: { team: { gameReportedName: null } } })
})
