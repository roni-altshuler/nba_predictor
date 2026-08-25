import {
  POLL_IN_GAME_MS,
  POLL_PRE_GAME_MS,
  nextPollDelayMs,
  parseLiveSummary,
  parseScoreboard,
  periodLabel,
} from '@/lib/espnLive'

/**
 * Fixtures follow the shape RECORDED from the live endpoint on 2026-08-25
 * (`site.web.api.espn.com/.../scoreboard`, and `/summary?event=401859963`
 * for a completed Finals game), trimmed to the fields the parser reads plus
 * the neighbours it must ignore. The pre event is the real MIA @ TOR
 * preseason row; the post event is the real NY @ SA final; the in-progress
 * event is hand-built on the same schema, since nothing is live in August.
 */

const PRE_EVENT = {
  id: '401902644',
  uid: 's:40~l:46~e:401902644',
  date: '2026-10-03T23:00Z',
  name: 'Miami Heat at Toronto Raptors',
  shortName: 'MIA @ TOR',
  season: { year: 2027, type: 1, slug: 'preseason' },
  competitions: [
    {
      id: '401902644',
      date: '2026-10-03T23:00Z',
      neutralSite: false,
      competitors: [
        {
          id: '28',
          homeAway: 'home',
          team: { id: '28', abbreviation: 'TOR', displayName: 'Toronto Raptors' },
          score: '0',
        },
        {
          id: '14',
          homeAway: 'away',
          team: { id: '14', abbreviation: 'MIA', displayName: 'Miami Heat' },
          score: '0',
        },
      ],
    },
  ],
  status: {
    clock: 0.0,
    displayClock: '0.0',
    period: 0,
    type: {
      id: '1',
      name: 'STATUS_SCHEDULED',
      state: 'pre',
      completed: false,
      description: 'Scheduled',
      shortDetail: '10/3 - 7:00 PM EDT',
    },
  },
}

const IN_EVENT = {
  id: '401800001',
  date: '2026-10-20T23:00Z',
  shortName: 'DET @ BOS',
  competitions: [
    {
      id: '401800001',
      competitors: [
        { id: '2', homeAway: 'home', team: { abbreviation: 'BOS' }, score: '87' },
        { id: '8', homeAway: 'away', team: { abbreviation: 'DET' }, score: '90' },
      ],
    },
  ],
  status: {
    clock: 252.0,
    displayClock: '4:12',
    period: 3,
    type: {
      id: '2',
      name: 'STATUS_IN_PROGRESS',
      state: 'in',
      completed: false,
      description: 'In Progress',
    },
  },
}

const POST_EVENT = {
  id: '401859963',
  date: '2026-06-04T00:30Z',
  shortName: 'NY @ SA',
  competitions: [
    {
      id: '401859963',
      competitors: [
        { id: '24', homeAway: 'home', team: { abbreviation: 'SA' }, score: '95' },
        { id: '18', homeAway: 'away', team: { abbreviation: 'NY' }, score: '105' },
      ],
    },
  ],
  status: {
    clock: 0.0,
    displayClock: '0.0',
    period: 4,
    type: {
      id: '3',
      name: 'STATUS_FINAL',
      state: 'post',
      completed: true,
      description: 'Final',
    },
  },
}

const envelope = (events: unknown[]) => ({
  leagues: [{ id: '46', abbreviation: 'NBA' }],
  season: { type: 1, year: 2027 },
  day: { date: '2026-10-03' },
  events,
})

describe('parseScoreboard', () => {
  it('parses the recorded envelope', () => {
    const rows = parseScoreboard(envelope([PRE_EVENT, IN_EVENT, POST_EVENT]))
    expect(rows).toHaveLength(3)

    const [pre, live, post] = rows!
    expect(pre).toEqual({
      id: '401902644',
      state: 'pre',
      completed: false,
      period: 0,
      displayClock: '0.0',
      // ESPN publishes scores as strings, and a pre-game "0" is a real
      // zero, not a missing value — Number(null) is also 0, which is why
      // the two must be told apart.
      homeScore: 0,
      awayScore: 0,
      startUtc: '2026-10-03T23:00Z',
    })
    expect(live.state).toBe('in')
    expect(live.period).toBe(3)
    expect(live.displayClock).toBe('4:12')
    expect(live.homeScore).toBe(87)
    expect(live.awayScore).toBe(90)
    expect(live.completed).toBe(false)
    expect(post.state).toBe('post')
    expect(post.completed).toBe(true)
    expect(post.awayScore).toBe(105)
    expect(post.homeScore).toBe(95)
  })

  it('returns null for a junk envelope', () => {
    // A payload with no events array is a failed fetch in disguise — the
    // caller's retry logic must see it as one, not as an empty slate.
    expect(parseScoreboard(null)).toBeNull()
    expect(parseScoreboard(undefined)).toBeNull()
    expect(parseScoreboard('nope')).toBeNull()
    expect(parseScoreboard(42)).toBeNull()
    expect(parseScoreboard({})).toBeNull()
    expect(parseScoreboard({ events: 'nope' })).toBeNull()
    expect(parseScoreboard({ events: {} })).toBeNull()
  })

  it('returns an empty list for an empty board — the offseason answer', () => {
    expect(parseScoreboard(envelope([]))).toEqual([])
  })

  it('skips junk events without dropping the good ones', () => {
    const rows = parseScoreboard(
      envelope([
        null,
        42,
        {},
        { id: '1' }, // no status at all
        { id: '2', status: { type: { state: 'STATUS_WEIRD' } } },
        { status: { type: { state: 'in' } } }, // no id
        IN_EVENT,
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows![0].id).toBe('401800001')
  })

  it('tolerates missing scores, clock and competitors', () => {
    const rows = parseScoreboard(
      envelope([
        {
          id: '77',
          status: { type: { state: 'in' } },
          competitions: [
            {
              competitors: [
                { homeAway: 'home', score: '' },
                { homeAway: 'away', score: 'TBD' },
              ],
            },
          ],
        },
        { id: '78', status: { type: { state: 'pre' } } },
      ]),
    )
    expect(rows).toHaveLength(2)
    expect(rows![0]).toMatchObject({
      id: '77',
      state: 'in',
      homeScore: null,
      awayScore: null,
      displayClock: null,
      period: null,
    })
    expect(rows![1]).toMatchObject({ id: '78', state: 'pre', startUtc: null })
  })
})

describe('parseLiveSummary', () => {
  const summary = (over: Record<string, unknown> = {}) => ({
    header: {
      id: '401800001',
      competitions: [
        {
          id: '401800001',
          status: {
            displayClock: '4:12',
            period: 3,
            type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false },
          },
          competitors: [
            { id: '2', homeAway: 'home', score: '87' },
            { id: '8', homeAway: 'away', score: '90' },
          ],
        },
      ],
    },
    winprobability: [
      { homeWinPercentage: 0.5, tiePercentage: 0.0, playId: '4018000011' },
      { homeWinPercentage: 0.874, tiePercentage: 0.0, playId: '4018000012' },
    ],
    ...over,
  })

  it('parses the live slice, win probability from the LAST valid point', () => {
    expect(parseLiveSummary(summary())).toEqual({
      id: '401800001',
      state: 'in',
      completed: false,
      period: 3,
      displayClock: '4:12',
      homeScore: 87,
      awayScore: 90,
      espnHomeWinProbability: 0.874,
    })
  })

  it('walks past trailing junk points rather than reporting them as now', () => {
    const parsed = parseLiveSummary(
      summary({
        winprobability: [
          { homeWinPercentage: 0.62, playId: '1' },
          { homeWinPercentage: null, playId: '2' },
          { homeWinPercentage: 'x', playId: '3' },
          { homeWinPercentage: 1.2, playId: '4' }, // out of range
        ],
      }),
    )
    expect(parsed?.espnHomeWinProbability).toBe(0.62)
  })

  it('reports no probability rather than a made-up one', () => {
    expect(
      parseLiveSummary(summary({ winprobability: undefined }))
        ?.espnHomeWinProbability,
    ).toBeNull()
    expect(
      parseLiveSummary(summary({ winprobability: [] }))?.espnHomeWinProbability,
    ).toBeNull()
  })

  it('parses a final the way the recorded document reads', () => {
    // Recorded 2026-08-25: a final's header status carries only the type —
    // no period or displayClock — and the last curve point is 0.0, a legal
    // probability that must not be dropped as falsy.
    const parsed = parseLiveSummary({
      header: {
        id: '401859963',
        competitions: [
          {
            status: {
              type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true },
            },
            competitors: [
              { id: '24', homeAway: 'home', score: '95' },
              { id: '18', homeAway: 'away', score: '105' },
            ],
          },
        ],
      },
      winprobability: [{ homeWinPercentage: 0.0, tiePercentage: 0.0, playId: 'x' }],
    })
    expect(parsed).toMatchObject({
      state: 'post',
      completed: true,
      period: null,
      displayClock: null,
      homeScore: 95,
      awayScore: 105,
      espnHomeWinProbability: 0,
    })
  })

  it('returns null on junk', () => {
    expect(parseLiveSummary(null)).toBeNull()
    expect(parseLiveSummary({})).toBeNull()
    expect(parseLiveSummary({ header: {} })).toBeNull()
    expect(parseLiveSummary({ header: { competitions: [] } })).toBeNull()
    expect(
      parseLiveSummary({ header: { competitions: [{ status: { type: { state: 'x' } } }] } }),
    ).toBeNull()
  })
})

describe('periodLabel', () => {
  it('labels quarters and overtimes, and refuses Q0', () => {
    expect(periodLabel(null)).toBeNull()
    expect(periodLabel(0)).toBeNull()
    expect(periodLabel(1)).toBe('Q1')
    expect(periodLabel(4)).toBe('Q4')
    expect(periodLabel(5)).toBe('OT')
    expect(periodLabel(6)).toBe('2OT')
    expect(periodLabel(7)).toBe('3OT')
  })
})

describe('nextPollDelayMs — the entire cost model of live mode', () => {
  const NOW = Date.parse('2026-10-20T23:30:00Z')
  const row = (over: Record<string, unknown>) => ({
    id: '1',
    state: 'pre' as const,
    completed: false,
    period: null,
    displayClock: null,
    homeScore: null,
    awayScore: null,
    startUtc: null,
    ...over,
  })

  const slateGame = (dateUtc: string, id = 's1') => ({ id, dateUtc })

  it('polls fast while anything is in progress', () => {
    expect(
      nextPollDelayMs([row({ state: 'in' }), row({ id: '2', state: 'post' })], [], NOW),
    ).toBe(POLL_IN_GAME_MS)
  })

  it('polls slowly when a tip-off is inside the half-hour window', () => {
    const inTenMinutes = new Date(NOW + 10 * 60_000).toISOString()
    expect(
      nextPollDelayMs([row({ startUtc: inTenMinutes })], [], NOW),
    ).toBe(POLL_PRE_GAME_MS)
    // A slate tip counts when the board does not list that id — feed lag.
    expect(nextPollDelayMs([], [slateGame(inTenMinutes)], NOW)).toBe(
      POLL_PRE_GAME_MS,
    )
  })

  it('stops entirely when nothing is close — the offseason case', () => {
    const tomorrow = new Date(NOW + 24 * 3_600_000).toISOString()
    expect(nextPollDelayMs([], [], NOW)).toBeNull()
    expect(nextPollDelayMs([row({ startUtc: tomorrow })], [], NOW)).toBeNull()
    expect(nextPollDelayMs([], [slateGame(tomorrow)], NOW)).toBeNull()
    // Finished games hold nothing open.
    expect(
      nextPollDelayMs([row({ state: 'post', completed: true })], [], NOW),
    ).toBeNull()
  })

  it('the board outranks the schedule: a slate game gone post stops the poll', () => {
    // All tips are within the last four hours on any normal game night —
    // without this rule the page would poll an empty evening until the
    // plausibly-live bound ran out.
    const anHourAgo = new Date(NOW - 3_600_000).toISOString()
    expect(
      nextPollDelayMs(
        [row({ id: 's1', state: 'post', completed: true })],
        [slateGame(anHourAgo)],
        NOW,
      ),
    ).toBeNull()
  })

  it('a failed fetch on game night retries; a failed fetch in August does not', () => {
    const anHourAgo = new Date(NOW - 3_600_000).toISOString()
    const nextSpring = new Date(NOW + 180 * 24 * 3_600_000).toISOString()
    expect(nextPollDelayMs(null, [slateGame(anHourAgo)], NOW)).toBe(
      POLL_PRE_GAME_MS,
    )
    expect(nextPollDelayMs(null, [slateGame(nextSpring)], NOW)).toBeNull()
    expect(nextPollDelayMs(null, [], NOW)).toBeNull()
  })

  it('a pre game four hours past its tip is a postponement, not a late start', () => {
    const fiveHoursAgo = new Date(NOW - 5 * 3_600_000).toISOString()
    expect(
      nextPollDelayMs([row({ startUtc: fiveHoursAgo })], [], NOW),
    ).toBeNull()
    expect(nextPollDelayMs(null, [slateGame(fiveHoursAgo)], NOW)).toBeNull()
  })
})
