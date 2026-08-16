import { getEspnInjuries, getEspnWinProbability } from '@/lib/espn'

/**
 * The two ESPN reads added for the game page.
 *
 * Both follow the rule the box score set: **a failure returns nothing and
 * the page says so**, never a partial object that renders as a curve of one
 * point or an injury list that reads as a clean bill of health.
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

const INJURY_PAYLOAD = {
  injuries: [
    {
      id: '2',
      abbreviation: 'BOS',
      displayName: 'Boston Celtics',
      injuries: [
        {
          athlete: { displayName: 'Player Q', position: { abbreviation: 'G' } },
          status: 'Questionable',
          details: { type: 'Ankle' },
        },
        {
          athlete: { displayName: 'Player O', position: { abbreviation: 'C' } },
          status: 'Out',
          details: { type: 'Knee' },
        },
      ],
    },
    {
      id: '9',
      abbreviation: 'LAL',
      displayName: 'Los Angeles Lakers',
      injuries: [
        { athlete: { displayName: 'Player D' }, status: 'Day-To-Day' },
      ],
    },
    {
      id: '5',
      abbreviation: 'MIA',
      displayName: 'Miami Heat',
      injuries: [{ athlete: { displayName: 'Nobody' }, status: 'Out' }],
    },
  ],
}

describe('getEspnInjuries', () => {
  it('returns an empty list when the request fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    expect(await getEspnInjuries(['BOS'])).toEqual([])
  })

  it('keeps only the two teams in the game', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const result = await getEspnInjuries(['BOS', 'LAL'])
    expect(result.map((t) => t.abbreviation)).toEqual(['BOS', 'LAL'])
  })

  it('orders Out above Questionable', async () => {
    // A reader scanning this is looking for who is definitely missing;
    // alphabetical order buries that under whoever has an early surname.
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    const [boston] = await getEspnInjuries(['BOS'])
    expect(boston.entries.map((e) => e.status)).toEqual(['Out', 'Questionable'])
  })

  it('drops an entry with no player or no status rather than rendering blanks', async () => {
    fetchMock.mockReturnValue(
      ok({
        injuries: [
          {
            id: '2',
            abbreviation: 'BOS',
            injuries: [
              { athlete: { displayName: 'Real' }, status: 'Out' },
              { athlete: {}, status: 'Out' },
              { athlete: { displayName: 'Statusless' } },
            ],
          },
        ],
      }),
    )
    const [boston] = await getEspnInjuries(['BOS'])
    expect(boston.entries.map((e) => e.player)).toEqual(['Real'])
  })

  it('omits a team with nobody listed rather than showing an empty column', async () => {
    fetchMock.mockReturnValue(
      ok({ injuries: [{ id: '2', abbreviation: 'BOS', injuries: [] }] }),
    )
    expect(await getEspnInjuries(['BOS'])).toEqual([])
  })

  it('matches abbreviations case-insensitively', async () => {
    fetchMock.mockReturnValue(ok(INJURY_PAYLOAD))
    expect(await getEspnInjuries(['bos'])).toHaveLength(1)
  })
})
