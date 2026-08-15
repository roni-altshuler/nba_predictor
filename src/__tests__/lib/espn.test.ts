import { getEspnBoxScore } from '@/lib/espn'

/**
 * Parsing ESPN's box score.
 *
 * The shape here is trimmed from a real response for game 401859967 (the
 * 2026 Finals game 6), including its quirks: the totals row has empty
 * strings for MIN and plus/minus, and a DNP athlete carries a `reason` and
 * an empty stats array.
 */

const RESPONSE = {
  boxscore: {
    players: [
      {
        team: {
          id: '18',
          abbreviation: 'NY',
          displayName: 'New York Knicks',
          logo: 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png',
        },
        statistics: [
          {
            names: ['MIN', 'PTS', 'FG', '3PT', 'REB', 'AST', '+/-'],
            athletes: [
              {
                athlete: {
                  id: '1', displayName: 'OG Anunoby', shortName: 'O. Anunoby',
                  position: { abbreviation: 'F' }, jersey: '8',
                },
                starter: true,
                didNotPlay: false,
                stats: ['33', '11', '3-11', '1-5', '8', '0', '+2'],
              },
              {
                athlete: {
                  id: '2', displayName: 'Jalen Brunson', shortName: 'J. Brunson',
                  position: { abbreviation: 'G' }, jersey: '11',
                },
                starter: true,
                didNotPlay: false,
                stats: ['38', '29', '10-22', '3-8', '4', '7', '+6'],
              },
              {
                athlete: {
                  id: '3', displayName: 'Bench Guy', shortName: 'B. Guy',
                  position: { abbreviation: 'C' }, jersey: '44',
                },
                starter: false,
                didNotPlay: true,
                reason: 'DNP-COACH DECISION',
                stats: [],
              },
            ],
            totals: ['', '94', '31-87', '12-37', '48', '14', ''],
          },
        ],
      },
    ],
  },
}

describe('getEspnBoxScore', () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  function mockFetch(value: unknown, ok = true) {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      json: async () => value,
    }) as unknown as typeof fetch
  }

  it('reads the column order off the response rather than a hard-coded list', async () => {
    // ESPN's schema has changed between eras — plus/minus is not in every
    // one — so a header typed here would silently mislabel the whole table
    // the season it changes again.
    mockFetch(RESPONSE)
    const box = await getEspnBoxScore('401859967')
    expect(box?.teams[0].labels).toEqual([
      'MIN', 'PTS', 'FG', '3PT', 'REB', 'AST', '+/-',
    ])
  })

  it('keys each player line by column name, not by position', async () => {
    mockFetch(RESPONSE)
    const box = await getEspnBoxScore('401859967')
    const brunson = box?.teams[0].players.find((p) => p.name === 'Jalen Brunson')
    expect(brunson?.stats.PTS).toBe('29')
    expect(brunson?.stats.AST).toBe('7')
    expect(brunson?.stats.FG).toBe('10-22')
    expect(brunson?.starter).toBe(true)
  })

  it('keeps a DNP as a row with its reason, rather than dropping the player', async () => {
    // Who was unavailable is a fact about the game. Dropping them makes a
    // short rotation look like a choice rather than an injury list.
    mockFetch(RESPONSE)
    const box = await getEspnBoxScore('401859967')
    const dnp = box?.teams[0].players.find((p) => p.didNotPlay)
    expect(dnp?.name).toBe('Bench Guy')
    expect(dnp?.reason).toBe('DNP-COACH DECISION')
  })

  it('derives leaders from the same rows the table prints', async () => {
    // Not from ESPN's separate `leaders` block: two sources for one fact
    // eventually disagree, and here they would disagree on the same screen.
    mockFetch(RESPONSE)
    const box = await getEspnBoxScore('401859967')
    expect(box?.teams[0].leaders).toEqual([
      { label: 'Points', player: 'J. Brunson', value: '29' },
      { label: 'Rebounds', player: 'O. Anunoby', value: '8' },
      { label: 'Assists', player: 'J. Brunson', value: '7' },
    ])
  })

  it('never lets a DNP win a leader category', async () => {
    mockFetch({
      boxscore: {
        players: [
          {
            team: { id: '1', abbreviation: 'BOS', displayName: 'Boston', logo: null },
            statistics: [
              {
                names: ['PTS'],
                athletes: [
                  {
                    athlete: { id: '9', displayName: 'Played', shortName: 'Played' },
                    didNotPlay: false, starter: true, stats: ['4'],
                  },
                  {
                    athlete: { id: '10', displayName: 'Sat', shortName: 'Sat' },
                    didNotPlay: true, starter: false, stats: ['99'],
                  },
                ],
                totals: ['4'],
              },
            ],
          },
        ],
      },
    })
    const box = await getEspnBoxScore('1')
    expect(box?.teams[0].leaders[0].player).toBe('Played')
  })

  it('drops the empty cells in the totals row instead of printing blanks', async () => {
    mockFetch(RESPONSE)
    const box = await getEspnBoxScore('401859967')
    expect(box?.teams[0].totals.PTS).toBe('94')
    expect(box?.teams[0].totals.MIN).toBeUndefined()
  })

  it('returns null on an error response so the page can say so', async () => {
    mockFetch({}, false)
    expect(await getEspnBoxScore('1')).toBeNull()
  })

  it('returns null when the request throws, never a partial box score', async () => {
    // An ESPN outage must not take down the result, the quarters or the
    // forecast, all of which come from our own artifacts.
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch
    expect(await getEspnBoxScore('1')).toBeNull()
  })

  it('returns null when the payload carries no player block', async () => {
    mockFetch({ boxscore: { players: [] } })
    expect(await getEspnBoxScore('1')).toBeNull()
  })
})
