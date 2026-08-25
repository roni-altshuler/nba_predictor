'use client'

import { useCallback, useState } from 'react'

import { pct } from '@/lib/format'
import {
  fetchLiveSummary,
  periodLabel,
  PLAUSIBLY_LIVE_MS,
  POLL_PRE_GAME_MS,
  POLL_SUMMARY_MS,
  SOON_WINDOW_MS,
  type LiveSummary,
} from '@/lib/espnLive'
import { LiveBadge } from './LiveBadge'
import { useVisibilityPolling } from './useVisibilityPolling'

/**
 * The live strip on an upcoming game's page.
 *
 * Renders nothing until this specific event is actually happening, then
 * polls its summary document (same CORS-open host as the scoreboard) while
 * — and only while — the game is `in`. Score, period, clock, and ESPN's
 * current win probability when the document carries one.
 *
 * **The win probability is ESPN's and the strip says so.** The standing
 * rule is that this frontend never computes a probability; ESPN's number is
 * displayed verbatim, labelled, or not at all. It is a different model —
 * it reads possession and fouls, ours reads nothing after tip-off — and
 * the caption keeps the two from blurring.
 *
 * The cost model, in tick order:
 * - more than ~6h before tip (every offseason visit): no request, ever
 * - inside 6h but before the 30-minute window: sleep until the window
 * - window open, still `pre` (or a poll failed): every 5 minutes, until
 *   the game is four hours past its tip — a postponement stops the loop
 * - `in`: every 45 seconds, paused while the tab is hidden
 * - `post`: one final render, polling over
 */

/** Beyond this before tip, the strip does not even arm its timer. */
const ARM_WINDOW_MS = 6 * 3_600_000

export function LiveGameStrip({
  gameId,
  dateUtc,
  homeAbbr,
  awayAbbr,
}: {
  gameId: string
  dateUtc: string
  homeAbbr: string
  awayAbbr: string
}) {
  const [summary, setSummary] = useState<LiveSummary | null>(null)

  const tick = useCallback(async (): Promise<number | null> => {
    const now = Date.now()
    const tip = Date.parse(dateUtc)

    if (Number.isFinite(tip)) {
      const untilWindow = tip - SOON_WINDOW_MS - now
      if (untilWindow > 0) {
        // Not yet inside the half-hour window: no request. A reader who
        // keeps the page open is woken exactly when the window opens; a
        // reader browsing a fixture weeks out costs ESPN nothing at all.
        return untilWindow <= ARM_WINDOW_MS ? untilWindow : null
      }
    }

    const next = await fetchLiveSummary(gameId)
    setSummary(next)

    if (next?.state === 'in') return POLL_SUMMARY_MS
    if (next?.state === 'post') return null
    // Still `pre`, or the fetch failed. Keep checking slowly while the game
    // could still plausibly start; with no parseable tip there is nothing
    // to bound the loop, so it stops rather than polling forever.
    if (Number.isFinite(tip) && now - tip <= PLAUSIBLY_LIVE_MS) {
      return POLL_PRE_GAME_MS
    }
    return null
  }, [gameId, dateUtc])

  useVisibilityPolling(tick)

  if (!summary || summary.state === 'pre') return null

  const haveScore = summary.homeScore !== null && summary.awayScore !== null

  if (summary.state === 'post') {
    // `completed` distinguishes a final from a postponement, which ESPN
    // also files under `post`. A postponed game gets nothing — its makeup
    // arrives under a new event id and this page knows nothing about it.
    if (!summary.completed) return null
    return (
      <section className="card mb-6 p-4" data-live-strip="final">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm">Final</h2>
          {haveScore ? (
            <span className="numeric text-lg text-[var(--text-primary)]">
              {awayAbbr} {summary.awayScore} – {summary.homeScore} {homeAbbr}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          Final — the archive page updates with the next data refresh.
        </p>
      </section>
    )
  }

  const phase = [periodLabel(summary.period), summary.displayClock]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="card mb-6 p-4" data-live-strip="in">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <LiveBadge />
          {phase ? (
            <span className="font-numeric text-[11px] text-[var(--text-secondary)]">
              {phase}
            </span>
          ) : null}
        </span>
      </div>

      {haveScore ? (
        <p className="numeric text-2xl text-[var(--text-primary)]">
          {awayAbbr} {summary.awayScore} – {summary.homeScore} {homeAbbr}
        </p>
      ) : null}

      {summary.espnHomeWinProbability !== null ? (
        <p className="mt-3 border-t border-[var(--border-color)] pt-3 text-[11px] leading-relaxed">
          <span className="font-numeric uppercase tracking-[0.12em] text-[var(--accent-info)]">
            ESPN win probability
          </span>{' '}
          <span className="numeric text-[var(--text-primary)]">
            {homeAbbr} {pct(summary.espnHomeWinProbability)}
          </span>
          <span className="text-[var(--text-tertiary)]">
            {' '}
            — displayed verbatim from ESPN, a model that reads the game as it
            runs. The forecast below is pre-game and does not update in play.
          </span>
        </p>
      ) : null}
    </section>
  )
}
