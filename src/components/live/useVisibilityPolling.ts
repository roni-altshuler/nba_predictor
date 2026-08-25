'use client'

import { useEffect, useRef } from 'react'

/**
 * Read fresh, every time.
 *
 * Behind a function because `document.visibilityState` is read on both
 * sides of an `await` and TypeScript would otherwise narrow the second
 * read to the first read's literal type — turning the post-fetch check
 * into a comparison it believes can never be true. The type error was
 * telling the truth about the narrowing and a lie about the runtime: a tab
 * hidden DURING a poll is the exact case that check exists for.
 */
const hidden = () => document.visibilityState === 'hidden'

/**
 * Drives a poll loop whose cadence the tick itself decides.
 *
 * `tick` runs once on mount and returns the delay in milliseconds until it
 * should run again — or null to stop for good. Putting the cadence decision
 * inside the tick keeps this hook dumb and the cost model in one testable
 * place (`nextPollDelayMs`, or the strip's own window logic).
 *
 * **A hidden tab does not poll.** When the document goes hidden the pending
 * timer is cleared; when it becomes visible again the loop resumes with an
 * immediate tick, so a reader returning mid-game sees a fresh score at once
 * instead of one up to a poll-interval stale. A loop that has STOPPED
 * (tick returned null) stays stopped — pause and stop are different states,
 * and conflating them would turn every offseason tab-switch into a refetch
 * loop.
 *
 * The tick is kept in a ref so a re-render with a new closure never
 * restarts the loop — the same pattern `AnimatedNumber` uses for its
 * formatter.
 */
export function useVisibilityPolling(tick: () => Promise<number | null>): void {
  const tickRef = useRef(tick)
  tickRef.current = tick

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let disposed = false
    let running = false

    const run = async () => {
      if (disposed || stopped || running) return
      if (hidden()) return
      running = true
      let delay: number | null = null
      try {
        delay = await tickRef.current()
      } finally {
        running = false
      }
      if (disposed) return
      if (delay === null) {
        stopped = true
        return
      }
      // If the tab went hidden while the fetch was in flight, schedule
      // nothing — the visibility handler restarts the loop on return.
      if (hidden()) return
      timer = setTimeout(run, delay)
    }

    const onVisibility = () => {
      if (hidden()) {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
      } else if (!stopped && !running && timer === null) {
        void run()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    void run()

    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
