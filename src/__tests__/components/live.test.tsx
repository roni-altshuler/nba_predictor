import { act, render, screen } from '@testing-library/react'

import { GameCard } from '@/components/forecast/GameCard'
import { LiveBadge } from '@/components/live/LiveBadge'
import { LiveGameStrip } from '@/components/live/LiveGameStrip'
import { LiveSlate } from '@/components/live/LiveSlate'
import type { GameForecast } from '@/lib/artifacts'
import type { LiveScore } from '@/lib/espnLive'

const forecast = (id: string, dateUtc: string): GameForecast => ({
  game_id: id,
  date_utc: dateUtc,
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
})

const liveRow = (over: Partial<LiveScore> = {}): LiveScore => ({
  id: '1',
  state: 'in',
  completed: false,
  period: 3,
  displayClock: '4:12',
  homeScore: 87,
  awayScore: 90,
  startUtc: '2026-10-20T23:00Z',
  ...over,
})

/** Scoreboard-shaped event, matching the recorded envelope. */
const inEvent = (id: string, awayScore: string, homeScore: string) => ({
  id,
  date: '2026-10-20T23:00Z',
  competitions: [
    {
      competitors: [
        { id: 'h', homeAway: 'home', score: homeScore },
        { id: 'a', homeAway: 'away', score: awayScore },
      ],
    },
  ],
  status: {
    displayClock: '4:12',
    period: 3,
    type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false },
  },
})

const jsonResponse = (payload: unknown) =>
  ({ ok: true, json: async () => payload }) as Response

describe('LiveBadge', () => {
  it('carries the word, never the dot alone', () => {
    // Colour-only state is forbidden here for the same reason a
    // probability is never a bar without a number.
    render(<LiveBadge />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})

describe('GameCard with a live row', () => {
  it('overlays score, period, clock and the badge on an in-progress game', () => {
    render(<GameCard game={forecast('1', '2026-10-20T23:00:00+00:00')} live={liveRow()} />)
    const score = screen.getByText('90–87')
    expect(score).toHaveAttribute('data-score', 'live')
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Q3 · 4:12')).toBeInTheDocument()
  })

  it('keeps the pre-game forecast visible beside the live score', () => {
    // The whole point of the overlay is watching the forecast meet
    // reality — the probability may never disappear behind the score.
    render(<GameCard game={forecast('1', '2026-10-20T23:00:00+00:00')} live={liveRow()} />)
    expect(screen.getByText('57.1%')).toBeInTheDocument()
    expect(screen.getByText('42.9%')).toBeInTheDocument()
    expect(screen.getByText(/made before tip-off/i)).toBeInTheDocument()
  })

  it('shows FINAL with the final score once completed', () => {
    render(
      <GameCard
        game={forecast('1', '2026-10-20T23:00:00+00:00')}
        live={liveRow({ state: 'post', completed: true, homeScore: 112, awayScore: 104 })}
      />,
    )
    expect(screen.getByText('Final')).toBeInTheDocument()
    expect(screen.getByText('104–112')).toHaveAttribute('data-score', 'final')
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
  })

  it('treats a post-but-not-completed row as a postponement, not a final', () => {
    // ESPN keeps a postponed event forever with completed: false and files
    // the makeup under a NEW id — rendering this as FINAL 0–0 would be a
    // fabricated result.
    render(
      <GameCard
        game={forecast('1', '2026-10-20T23:00:00+00:00')}
        live={liveRow({ state: 'post', completed: false, homeScore: 0, awayScore: 0 })}
      />,
    )
    expect(screen.queryByText('Final')).not.toBeInTheDocument()
    expect(screen.getByText('vs')).toHaveAttribute('data-score', 'pending')
  })

  it('falls back to vs when a live row carries no scores', () => {
    render(
      <GameCard
        game={forecast('1', '2026-10-20T23:00:00+00:00')}
        live={liveRow({ homeScore: null, awayScore: null })}
      />,
    )
    expect(screen.getByText('vs')).toHaveAttribute('data-score', 'pending')
  })
})

describe('LiveSlate', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    global.fetch = jest.fn()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('overlays only ids the slate already renders', async () => {
    jest.setSystemTime(new Date('2026-10-20T23:30:00Z'))
    // The board carries our game AND a game the forecasts never listed —
    // the second must produce nothing, anywhere.
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        events: [inEvent('401800001', '90', '87'), inEvent('999999', '118', '120')],
      }),
    )

    const { unmount } = render(
      <LiveSlate
        games={[
          forecast('401800001', '2026-10-20T23:00:00+00:00'),
          forecast('55555', '2026-10-21T00:00:00+00:00'),
        ]}
      />,
    )
    await act(async () => {})

    expect(screen.getByText('90–87')).toBeInTheDocument()
    expect(screen.queryByText('118–120')).not.toBeInTheDocument()
    expect(screen.queryByText('120–118')).not.toBeInTheDocument()
    // The card without a live row still reads as an upcoming fixture.
    expect(screen.getByText('vs')).toHaveAttribute('data-score', 'pending')
    unmount()
  })

  it('polls at 30s while a game is in progress', async () => {
    jest.setSystemTime(new Date('2026-10-20T23:30:00Z'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ events: [inEvent('401800001', '90', '87')] }),
    )

    const { unmount } = render(
      <LiveSlate games={[forecast('401800001', '2026-10-20T23:00:00+00:00')]} />,
    )
    await act(async () => {})
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000)
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('fetches once and goes quiet when nothing is live — the offseason', async () => {
    jest.setSystemTime(new Date('2026-08-25T12:00:00Z'))
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ events: [] }))

    const { unmount } = render(
      <LiveSlate games={[forecast('401800001', '2026-10-20T23:00:00+00:00')]} />,
    )
    await act(async () => {})
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(6 * 3_600_000)
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('pauses while the tab is hidden and refreshes the moment it returns', async () => {
    jest.setSystemTime(new Date('2026-10-20T23:30:00Z'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ events: [inEvent('401800001', '90', '87')] }),
    )
    const visibility = jest.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('visible')

    const { unmount } = render(
      <LiveSlate games={[forecast('401800001', '2026-10-20T23:00:00+00:00')]} />,
    )
    await act(async () => {})
    expect(global.fetch).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Coming back polls at once rather than up to a full interval stale.
    visibility.mockReturnValue('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('shows nothing live when the fetch fails — absent renders as absent', async () => {
    jest.setSystemTime(new Date('2026-10-20T23:30:00Z'))
    ;(global.fetch as jest.Mock).mockRejectedValue(new Error('offline'))

    const { unmount } = render(
      <LiveSlate games={[forecast('401800001', '2026-10-20T23:00:00+00:00')]} />,
    )
    await act(async () => {})
    expect(screen.getByText('vs')).toHaveAttribute('data-score', 'pending')
    expect(screen.queryByText('Live')).not.toBeInTheDocument()
    unmount()
  })
})

describe('LiveGameStrip', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    global.fetch = jest.fn()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const strip = (dateUtc: string) => (
    <LiveGameStrip gameId="401800001" dateUtc={dateUtc} homeAbbr="BOS" awayAbbr="DET" />
  )

  it('makes no request at all months before tip', async () => {
    jest.setSystemTime(new Date('2026-08-25T12:00:00Z'))
    const { container, unmount } = render(strip('2026-10-20T23:00:00+00:00'))
    await act(async () => {})
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_600_000)
    })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
    unmount()
  })

  it('renders score, period, clock and ESPN win probability labelled as ESPN when in progress', async () => {
    jest.setSystemTime(new Date('2026-10-20T23:45:00Z'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        header: {
          id: '401800001',
          competitions: [
            {
              status: {
                displayClock: '4:12',
                period: 3,
                type: { state: 'in', completed: false },
              },
              competitors: [
                { homeAway: 'home', score: '87' },
                { homeAway: 'away', score: '90' },
              ],
            },
          ],
        },
        winprobability: [{ homeWinPercentage: 0.874, playId: '1' }],
      }),
    )

    const { unmount } = render(strip('2026-10-20T23:00:00+00:00'))
    await act(async () => {})

    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Q3 · 4:12')).toBeInTheDocument()
    expect(screen.getByText('DET 90 – 87 BOS')).toBeInTheDocument()
    // ESPN's number, verbatim, and labelled as ESPN's — the frontend never
    // computes a probability of its own.
    expect(screen.getByText('ESPN win probability')).toBeInTheDocument()
    expect(screen.getByText('BOS 87.4%')).toBeInTheDocument()
    unmount()
  })

  it('shows the archive hand-off line after the final buzzer, then stops polling', async () => {
    jest.setSystemTime(new Date('2026-10-21T02:30:00Z'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        header: {
          id: '401800001',
          competitions: [
            {
              status: { type: { state: 'post', completed: true } },
              competitors: [
                { homeAway: 'home', score: '112' },
                { homeAway: 'away', score: '104' },
              ],
            },
          ],
        },
      }),
    )

    const { unmount } = render(strip('2026-10-20T23:00:00+00:00'))
    await act(async () => {})

    expect(
      screen.getByText(/the archive page updates with the next data refresh/i),
    ).toBeInTheDocument()
    expect(screen.getByText('DET 104 – 112 BOS')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_600_000)
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    unmount()
  })
})
