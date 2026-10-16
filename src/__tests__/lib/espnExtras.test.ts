import { getEspnInjuries, getEspnWinProbability } from '@/lib/espn'

/**
 * The two ESPN reads added for the game page.
 *
 * A missing curve stays null. Injury coverage distinguishes provider failure,
 * missing teams, incomplete entries and an explicitly empty team report.
 */

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

beforeEach(() => {
  fetchMock.mockReset()
})

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
}

/* ------------------------------------------------------ win probability */

function curve(values: number[]) {
  return {
    winprobability: values.map((homeWinPercentage, i) => ({
      playId: i * 3,
      homeWinPercentage,
      period: { number: Math.floor(i / 2) + 1 },
      clock: { displayValue: '5:00' },
    })),
  }
}

describe('getEspnWinProbability', () => {
  it('returns null when ESPN fails, so the rest of the page survives', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    expect(await getEspnWinProbability('1')).toBeNull()
  })

  it('returns null when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    expect(await getEspnWinProbability('1')).toBeNull()
  })

  it('returns null for a game with no curve rather than an empty chart', async () => {
    fetchMock.mockReturnValue(ok({ winprobability: [] }))
    expect(await getEspnWinProbability('1')).toBeNull()
  })

  it('refuses a single point, which is not a curve', async () => {
    fetchMock.mockReturnValue(ok(curve([0.5])))
    expect(await getEspnWinProbability('1')).toBeNull()
  })

  it('drops entries outside [0, 1] instead of plotting them off the axis', async () => {
    fetchMock.mockReturnValue(
      ok({
        winprobability: [
          { homeWinPercentage: 0.4 },
          { homeWinPercentage: 1.7 },
          { homeWinPercentage: null },
          { homeWinPercentage: 0.9 },
        ],
      }),
    )
    const result = await getEspnWinProbability('1')
    expect(result?.points).toHaveLength(2)
  })

  it('finds the largest single swing and which way it went', async () => {
    fetchMock.mockReturnValue(ok(curve([0.5, 0.52, 0.2, 0.25])))
    const result = await getEspnWinProbability('1')
    expect(result?.biggestSwing?.delta).toBeCloseTo(0.32, 5)
    expect(result?.biggestSwing?.toward).toBe('away')
  })

  it('reports the winner’s low-water mark as a comeback', async () => {
    // Home falls to 12% and wins: the comeback belongs to the home side.
    fetchMock.mockReturnValue(ok(curve([0.5, 0.12, 0.6, 0.98])))
    const result = await getEspnWinProbability('1')
    expect(result?.comebackFrom).toBeCloseTo(0.12, 5)
  })

  it('reports a comeback from the away side’s own perspective', async () => {
    // Home leads at 0.95 then loses: the away side fell to 5%.
    fetchMock.mockReturnValue(ok(curve([0.5, 0.95, 0.4, 0.02])))
    const result = await getEspnWinProbability('1')
    expect(result?.comebackFrom).toBeCloseTo(0.05, 5)
  })

  it('reports no comeback when the winner was never behind', async () => {
    fetchMock.mockReturnValue(ok(curve([0.6, 0.7, 0.85, 0.99])))
    const result = await getEspnWinProbability('1')
    expect(result?.comebackFrom).toBeNull()
  })
})

/* -------------------------------------------------------------- injuries */

/**
 * The real shape of `/basketball/nba/injuries`.
 *
 * Team blocks carry `id` and `displayName` and **no abbreviation** — the
 * first version of this reader filtered on one, matched nothing, and failed
 * soft into "No injury report" on every game. These fixtures are copied from
 * an actual response for that reason.
 */
const INJURY_PAYLOAD = {
  injuries: [
    {
      id: '2',
      displayName: 'Boston Celtics',
      injuries: [
        {
          athlete: { displayName: 'Player Q', position: { abbreviation: 'G' } },
          status: 'Questionable',
          date: '2026-08-01T00:00Z',
          details: { side: 'Left', type: 'Ankle', detail: 'Sprain' },
        },
        {
          athlete: { displayName: 'Player O', position: { abbreviation: 'C' } },
          status: 'Out',
          details: { type: 'Knee', detail: 'Surgery', returnDate: '2026-11-01' },
        },
      ],
    },
    {
      id: '13',
      displayName: 'Los Angeles Lakers',
      injuries: [
        { athlete: { displayName: 'Player D' }, status: 'Day-To-Day' },
      ],
    },
    {
      id: '14',
      displayName: 'Miami Heat',
      injuries: [{ athlete: { displayName: 'Nobody' }, status: 'Out' }],
    },
  ],
}

async function teamReports(names: string[]) {
  const result = await getEspnInjuries(names)
  expect(result.status).toBe('available')
  if (result.status !== 'available') throw new Error('Expected readable provider response')
  return result.teams
}

describe('getEspnInjuries', () => {
  it('distinguishes an HTTP failure from an empty report', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    expect(await getEspnInjuries(['Boston Celtics'])).toEqual({ status: 'unavailable', reason: 'http' })
  })

  it('calls /injuries, not /teams/injuries', async () => {
    // `/teams/injuries` answers 400 for every request. Because every reader
    // here fails soft, the wrong URL produced "No injury report" forever
    // rather than an error, and shipped.
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    await getEspnInjuries(['Boston Celtics'])
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toMatch(/\/basketball\/nba\/injuries$/)
    expect(url).not.toContain('/teams/')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ next: { revalidate: 21_600 } })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('matches teams on display name, since the payload has no abbreviation', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const result = await teamReports(['Boston Celtics', 'Los Angeles Lakers'])
    expect(result.map((t) => t.displayName)).toEqual([
      'Boston Celtics',
      'Los Angeles Lakers',
    ])
  })

  it('matches names case- and whitespace-insensitively', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    expect(await teamReports(['  boston celtics '])).toHaveLength(1)
  })

  it('orders Out above Questionable', async () => {
    // A reader scanning this is looking for who is definitely missing;
    // alphabetical order buries that under whoever has an early surname.
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const [boston] = await teamReports(['Boston Celtics'])
    expect(boston.entries.map((e) => e.status)).toEqual(['Out', 'Questionable'])
  })

  it('assembles a readable detail from ESPN’s separate fields', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const [boston] = await teamReports(['Boston Celtics'])
    const questionable = boston.entries.find((e) => e.status === 'Questionable')
    expect(questionable?.detail).toBe('Left ankle sprain')
  })

  it('carries the expected return date when ESPN publishes one', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const [boston] = await teamReports(['Boston Celtics'])
    const out = boston.entries.find((e) => e.status === 'Out')
    expect(out?.returnDate).toBe('2026-11-01')
  })

  it('reports no detail rather than an empty string', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const [lakers] = await teamReports(['Los Angeles Lakers'])
    expect(lakers.entries[0].detail).toBeNull()
    expect(lakers.entries[0].returnDate).toBeNull()
  })

  it('drops an entry with no player or no status rather than rendering blanks', async () => {
    fetchMock.mockReturnValue(
      ok({
        injuries: [
          {
            id: '2',
            displayName: 'Boston Celtics',
            injuries: [
              { athlete: { displayName: 'Real' }, status: 'Out' },
              { athlete: {}, status: 'Out' },
              { athlete: { displayName: 'Statusless' } },
            ],
          },
        ],
      }),
    )
    const [boston] = await teamReports(['Boston Celtics'])
    expect(boston.entries.map((e) => e.player)).toEqual(['Real'])
    expect(boston.coverage).toBe('partial')
  })

  it('preserves a matched team with an explicitly empty report', async () => {
    fetchMock.mockReturnValue(
      ok({ injuries: [{ id: '2', displayName: 'Boston Celtics', injuries: [] }] }),
    )
    expect(await teamReports(['Boston Celtics'])).toEqual([{ teamId: '2', displayName: 'Boston Celtics', entries: [], coverage: 'complete' }])
  })

  it('distinguishes a malformed payload from an empty report', async () => {
    fetchMock.mockReturnValue(ok({ code: 400, message: 'Failed' }))
    expect(await getEspnInjuries(['Boston Celtics'])).toEqual({ status: 'unavailable', reason: 'payload' })
  })

  it('distinguishes transport and abort failures', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))
    expect(await getEspnInjuries(['Boston Celtics'])).toEqual({ status: 'unavailable', reason: 'request' })
  })

  it('handles invalid JSON as a provider payload failure', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('JSON')) })
    expect(await getEspnInjuries(['Boston Celtics'])).toEqual({ status: 'unavailable', reason: 'payload' })
  })

  it.each([null, [], 'bad', 4, {}, { injuries: null }, { injuries: {} }, { injuries: 'bad' }, { injuries: [null, {}, { displayName: 4 }] }].map((payload) => [payload]))('rejects an invalid report envelope: %p', async (payload) => {
    fetchMock.mockReturnValue(ok(payload))
    expect(await getEspnInjuries(['Boston Celtics'])).toEqual({ status: 'unavailable', reason: 'payload' })
  })

  it('keeps an unmatched team absent while retaining reported empty coverage', async () => {
    fetchMock.mockReturnValue(ok({ injuries: [{ displayName: 'Boston Celtics', injuries: [] }] }))
    const result = await teamReports(['Boston Celtics', 'Detroit Pistons'])
    expect(result).toEqual([{ teamId: '', displayName: 'Boston Celtics', coverage: 'complete', entries: [] }])
  })

  it('does not infer team coverage from an empty league list', async () => {
    fetchMock.mockReturnValue(ok({ injuries: [] }))
    expect(await getEspnInjuries(['Boston Celtics'])).toEqual({ status: 'available', teams: [] })
  })

  it.each([undefined, null, {}, 'bad', 7])('marks a matched team with a malformed nested list incomplete: %p', async (injuries) => {
    fetchMock.mockReturnValue(ok({ injuries: [{ displayName: 'Boston Celtics', injuries }] }))
    expect(await teamReports(['Boston Celtics'])).toEqual([{ teamId: '', displayName: 'Boston Celtics', coverage: 'partial', entries: [] }])
  })

  it('does not throw on malformed nested blocks, players, status, position or details', async () => {
    fetchMock.mockReturnValue(ok({ injuries: [null, 1, [], { displayName: {} }, {
      displayName: 'Boston Celtics', injuries: [null, [], 1, { athlete: 'bad', status: 'Out' },
        { athlete: { displayName: {} }, status: 'Out' }, { athlete: { displayName: 'Blank' }, status: ' ' },
        { athlete: { displayName: 'Bad status' }, status: {} },
        { athlete: { displayName: 'Usable', position: 'bad' }, status: ' Out ', details: { side: {}, type: [] } },
      ],
    }] }))
    const [team] = await teamReports(['Boston Celtics'])
    expect(team.coverage).toBe('partial')
    expect(team.entries).toEqual([{ player: 'Usable', position: null, status: 'Out', detail: null, returnDate: null, date: null }])
  })

  it('does not certify an all-invalid player list as empty', async () => {
    fetchMock.mockReturnValue(ok({ injuries: [{ displayName: 'Boston Celtics', injuries: [null, {}] }] }))
    expect((await teamReports(['Boston Celtics']))[0]).toMatchObject({ coverage: 'partial', entries: [] })
  })

  it('retains usable entries from duplicate team blocks without certifying complete coverage', async () => {
    fetchMock.mockReturnValue(ok({ injuries: [
      { displayName: 'Boston Celtics', injuries: [{ athlete: { displayName: 'A' }, status: 'Questionable' }] },
      { displayName: 'boston celtics', injuries: [{ athlete: { displayName: 'B' }, status: 'Out' }] },
    ] }))
    const teams = await teamReports(['Boston Celtics'])
    expect(teams).toHaveLength(1)
    expect(teams[0].coverage).toBe('partial')
    expect(teams[0].entries.map((entry) => entry.player)).toEqual(['B', 'A'])
  })

  it.each(['2026-10-14', '2026-10-14T18:45Z', '2026-10-14T18:45:30.123Z', '2026-10-14T18:45:00-04:00', '2024-02-29'])('preserves a genuine validated provider entry date: %s', async (date) => {
    fetchMock.mockReturnValue(ok({ injuries: [{ displayName: 'Boston Celtics', injuries: [{ athlete: { displayName: 'A' }, status: 'Out', date }] }] }))
    expect((await teamReports(['Boston Celtics']))[0].entries[0].date).toBe(date)
  })

  it.each([undefined, null, '', 'bad', '2026-02-30', '2025-02-29', '2026-13-01', '2026-10-14T25:00Z', '2026-10-14T12:60Z', '2026-10-14T12:30', '10/14/2026', 1792000000000, {}])('does not invent a date for an absent or invalid provider value: %p', async (date) => {
    fetchMock.mockReturnValue(ok({ injuries: [{ displayName: 'Boston Celtics', injuries: [{ athlete: { displayName: 'A' }, status: 'Out', date, details: { returnDate: date } }] }] }))
    expect((await teamReports(['Boston Celtics']))[0].entries[0]).toMatchObject({ date: null, returnDate: null })
  })
})
