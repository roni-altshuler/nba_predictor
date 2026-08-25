'use client'

import { useCallback, useRef, useState } from 'react'

import {
  fetchLiveScoreboard,
  nextPollDelayMs,
  type LiveScore,
} from '@/lib/espnLive'
import { useVisibilityPolling } from './useVisibilityPolling'

/**
 * The scoreboard poll: live rows for today's slate, keyed by ESPN event id.
 *
 * **The overlay never invents a game.** ESPN's board is filtered to the ids
 * the forecast already renders — an event the forecasts do not list (a
 * makeup game published under a new id, an exhibition) produces no card,
 * because a card without a forecast under it would be exactly the surface
 * this site exists not to be. ESPN's event id is the same id
 * `game_forecasts.json` keys games by, which is what makes the join exact
 * rather than fuzzy.
 *
 * Cadence lives in `nextPollDelayMs` (30s in-game, 5min near tip, otherwise
 * one fetch and silence) and pausing lives in `useVisibilityPolling`. All
 * of it runs in the reader's browser: zero function invocations, zero ISR
 * writes, no new API routes.
 *
 * **A failed poll clears the overlay.** Absent renders as absent — a score
 * this poll could not confirm is not shown a poll-interval stale. The next
 * successful poll restores it.
 */

export interface SlateGameRef {
  /** ESPN event id, as published in `game_forecasts.json`. */
  id: string
  /** Scheduled tip-off, ISO — feeds the poll-cadence decision. */
  dateUtc: string
}

export function useLiveScores(
  slate: SlateGameRef[],
): Record<string, LiveScore> {
  const [live, setLive] = useState<Record<string, LiveScore>>({})

  // The slate arrives as a fresh array every render; a ref keeps the tick
  // closure stable so the poll loop never restarts over a re-render.
  const slateRef = useRef(slate)
  slateRef.current = slate

  const tick = useCallback(async () => {
    const scores = await fetchLiveScoreboard()
    const known = new Set(slateRef.current.map((game) => game.id))
    const next: Record<string, LiveScore> = {}
    if (scores) {
      for (const score of scores) {
        if (known.has(score.id)) next[score.id] = score
      }
    }
    setLive((previous) =>
      // The common case outside game night: empty before, empty after.
      // Keeping the same object skips a re-render of every card each poll.
      Object.keys(previous).length === 0 && Object.keys(next).length === 0
        ? previous
        : next,
    )
    return nextPollDelayMs(scores, slateRef.current, Date.now())
  }, [])

  useVisibilityPolling(tick)

  return live
}
