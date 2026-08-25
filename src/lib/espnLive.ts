/**
 * Live scores, read from ESPN's scoreboard IN THE BROWSER.
 *
 * This is the one data path in the app that runs client-side, and that is
 * the point of it: game night should feel alive without a redeploy and
 * without a single Vercel function invocation or ISR write. The page is
 * still built from our own artifacts; this layer only OVERLAYS what ESPN
 * says is happening right now on games the forecast already lists.
 *
 * **`site.web.api.espn.com`, never `site.api`.** The `site.api` host is
 * fronted by an Akamai config that 403s datacentre IPs and sends no CORS
 * headers; the sibling `site.web.api` host serves the same documents with
 * `access-control-allow-origin: *` (verified against the live endpoint),
 * which is what makes a browser fetch possible at all. Same lesson as
 * `src/lib/espn.ts` and CLAUDE.md, restated because this is a new call site
 * — and the first one where CORS, not just the 403, is load-bearing.
 *
 * **Any fetch or parse failure returns null.** The UI then shows nothing
 * live — absent renders as absent, the house rule. A score we could not
 * confirm this poll is not a score.
 *
 * **Nothing here computes a probability.** The one probability this module
 * carries out of the summary endpoint is ESPN's own in-game number, passed
 * through verbatim for the UI to label as ESPN's.
 */

export const LIVE_SCOREBOARD_URL =
  'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
export const LIVE_SUMMARY_URL =
  'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary'

/* ------------------------------------------------------------- cadences */

/** While any game is in progress: every 30 seconds. */
export const POLL_IN_GAME_MS = 30_000
/** While a tip-off is imminent (or a poll failed on game night): 5 minutes. */
export const POLL_PRE_GAME_MS = 300_000
/** The game-detail summary poll, only while that game is `in`. */
export const POLL_SUMMARY_MS = 45_000
/** "Starts soon" means within half an hour of tip. */
export const SOON_WINDOW_MS = 30 * 60_000
/**
 * How long after its scheduled tip a game is still plausibly running.
 * An NBA game takes ~2.5 hours; four is generous. Past this, a game the
 * feed still calls `pre` is a postponement, not a late tip, and polling
 * for it forever would be the offseason leak this constant exists to stop.
 */
export const PLAUSIBLY_LIVE_MS = 4 * 3_600_000

const TIMEOUT_MS = 8_000

/* ---------------------------------------------------------------- types */

export type LiveState = 'pre' | 'in' | 'post'

/** One event from the scoreboard, reduced to what the overlay renders. */
export interface LiveScore {
  /** ESPN's event id — the same id `game_forecasts.json` keys games by. */
  id: string
  state: LiveState
  /**
   * True only when the game is genuinely over. A postponed game reads
   * `post` with `completed: false`, and must never render as FINAL.
   */
  completed: boolean
  period: number | null
  displayClock: string | null
  homeScore: number | null
  awayScore: number | null
  /** Scheduled tip-off, ISO. Used only to decide the poll cadence. */
  startUtc: string | null
}

/** The live slice of one game's summary document. */
export interface LiveSummary {
  id: string
  state: LiveState
  completed: boolean
  period: number | null
  displayClock: string | null
  homeScore: number | null
  awayScore: number | null
  /**
   * ESPN's current home win probability, 0–1, from the LAST valid point of
   * the summary's `winprobability` curve. **ESPN's number, verbatim** — the
   * frontend never computes a probability, so the UI shows this labelled as
   * ESPN's or shows nothing. Null when the document carries no curve.
   */
  espnHomeWinProbability: number | null
}

/* -------------------------------------------------------------- parsing */

function liveStateOf(value: unknown): LiveState | null {
  return value === 'pre' || value === 'in' || value === 'post' ? value : null
}

/**
 * ESPN publishes scores as strings ("105"). `Number(null)` is 0 and 0 is a
 * legal score, so null/undefined/empty are rejected BEFORE the conversion —
 * the same trap `lib/espn.ts` documents for `homeWinPercentage`.
 */
function scoreOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function intOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/* ESPN's payload is untyped by definition here; the whole job of this file
   is to turn it into the typed shapes above without trusting any field to
   exist — same approach as `lib/espn.ts`. */

function parseEvent(event: any): LiveScore | null {
  try {
    const id = event?.id
    if (id === null || id === undefined || id === '') return null
    const state = liveStateOf(event?.status?.type?.state)
    if (!state) return null

    let home: any = null
    let away: any = null
    const competitors = event?.competitions?.[0]?.competitors
    if (Array.isArray(competitors)) {
      for (const competitor of competitors) {
        if (competitor?.homeAway === 'home') home = competitor
        else if (competitor?.homeAway === 'away') away = competitor
      }
    }

    return {
      id: String(id),
      state,
      completed: event?.status?.type?.completed === true,
      period: intOrNull(event?.status?.period),
      displayClock: textOrNull(event?.status?.displayClock),
      homeScore: scoreOrNull(home?.score),
      awayScore: scoreOrNull(away?.score),
      startUtc: textOrNull(event?.date),
    }
  } catch {
    return null
  }
}

/**
 * The scoreboard envelope: `{ leagues, season, day, events, provider }`,
 * each event carrying `status.type.{state, completed}` and
 * `competitions[0].competitors[].{homeAway, score}`. Verified against the
 * live endpoint (2026-08-25) rather than assumed.
 *
 * A junk EVENT is skipped; a junk ENVELOPE is null. The distinction
 * matters: one malformed row must not blank every live score on the page,
 * but a payload with no events array is a failed fetch in disguise and the
 * caller's retry logic needs to know.
 */
export function parseScoreboard(payload: unknown): LiveScore[] | null {
  const events = (payload as { events?: unknown } | null | undefined)?.events
  if (!Array.isArray(events)) return null
  const out: LiveScore[] = []
  for (const event of events) {
    const row = parseEvent(event)
    if (row) out.push(row)
  }
  return out
}

/**
 * The live slice of a summary document: `header.competitions[0]` carries
 * status and competitors on the same shapes as the scoreboard, and
 * `winprobability` is a flat array of `{ homeWinPercentage, playId }`
 * (verified live — a finished game carries ~500 points and no clock fields,
 * so nothing here requires them).
 */
export function parseLiveSummary(payload: unknown): LiveSummary | null {
  try {
    const root = payload as any
    const competition = root?.header?.competitions?.[0]
    const state = liveStateOf(competition?.status?.type?.state)
    if (!state) return null

    let home: any = null
    let away: any = null
    const competitors = competition?.competitors
    if (Array.isArray(competitors)) {
      for (const competitor of competitors) {
        if (competitor?.homeAway === 'home') home = competitor
        else if (competitor?.homeAway === 'away') away = competitor
      }
    }

    // The LAST valid point of the curve is "now". Trailing junk is walked
    // past rather than treated as the current number.
    let winProbability: number | null = null
    const curve = root?.winprobability
    if (Array.isArray(curve)) {
      for (let i = curve.length - 1; i >= 0; i -= 1) {
        const value = curve[i]?.homeWinPercentage
        if (value === null || value === undefined || value === '') continue
        const p = Number(value)
        if (Number.isFinite(p) && p >= 0 && p <= 1) {
          winProbability = p
          break
        }
      }
    }

    return {
      id: String(root?.header?.id ?? ''),
      state,
      completed: competition?.status?.type?.completed === true,
      period: intOrNull(competition?.status?.period),
      displayClock: textOrNull(competition?.status?.displayClock),
      homeScore: scoreOrNull(home?.score),
      awayScore: scoreOrNull(away?.score),
      espnHomeWinProbability: winProbability,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------- fetching */

function requestTimeout(): AbortSignal | undefined {
  // Guarded because jsdom (tests) may not carry AbortSignal.timeout.
  return typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      // A live score must never come out of the HTTP cache.
      cache: 'no-store',
      signal: requestTimeout(),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/** Today's scoreboard. Null on any failure — the UI shows nothing live. */
export async function fetchLiveScoreboard(): Promise<LiveScore[] | null> {
  const payload = await fetchJson(LIVE_SCOREBOARD_URL)
  return payload === null ? null : parseScoreboard(payload)
}

/** One game's summary, reduced to its live slice. Null on any failure. */
export async function fetchLiveSummary(
  gameId: string,
): Promise<LiveSummary | null> {
  const payload = await fetchJson(
    `${LIVE_SUMMARY_URL}?event=${encodeURIComponent(gameId)}`,
  )
  return payload === null ? null : parseLiveSummary(payload)
}

/* ------------------------------------------------------------ cadence */

/**
 * How long until the scoreboard should be polled again. Null means stop.
 *
 * The whole cost model of live mode is this function:
 *
 * - any event `in`                        → 30 seconds
 * - a tip-off within ~30 minutes          → 5 minutes
 * - otherwise                             → stop. One fetch, then silence —
 *   in the offseason the component asks once, finds nothing, and goes
 *   quiet for the life of the page.
 *
 * `scores === null` is a FAILED fetch, and it is not allowed to kill game
 * night: if the slate the page renders says a game should be running (tip
 * within the last four hours, or inside the half-hour window), retry at the
 * slow cadence. When the slate itself says nothing is close, a failure
 * stops exactly like an empty board — an offseason network blip must not
 * start a poll loop.
 *
 * On a SUCCESSFUL fetch the board outranks the schedule: a slate game's tip
 * time only counts as "soon" when the board does not list that id at all
 * (feed lag), so an evening whose games have all gone `post` stops rather
 * than polling until the four-hour bound runs out. "Starts soon" also
 * covers a `pre` event whose tip has PASSED (delayed tip), bounded by
 * {@link PLAUSIBLY_LIVE_MS} so a postponed game cannot hold a poll open
 * all night.
 */
export function nextPollDelayMs(
  scores: LiveScore[] | null,
  slate: Array<{ id: string; dateUtc: string }>,
  now: number,
): number | null {
  if (scores?.some((score) => score.state === 'in')) return POLL_IN_GAME_MS

  const starts: number[] = []
  const onBoard = new Set((scores ?? []).map((score) => score.id))
  for (const game of slate) {
    if (scores && onBoard.has(game.id)) continue
    const t = Date.parse(game.dateUtc)
    if (Number.isFinite(t)) starts.push(t)
  }
  if (scores) {
    for (const score of scores) {
      if (score.state !== 'pre' || !score.startUtc) continue
      const t = Date.parse(score.startUtc)
      if (Number.isFinite(t)) starts.push(t)
    }
  }

  const soon = starts.some(
    (t) => t - now <= SOON_WINDOW_MS && now - t <= PLAUSIBLY_LIVE_MS,
  )
  return soon ? POLL_PRE_GAME_MS : null
}

/* ------------------------------------------------------------ labelling */

/**
 * "Q3", "OT", "2OT". Null for anything that is not a playing period —
 * ESPN reports `period: 0` before tip, and rendering "Q0" would be worse
 * than rendering nothing.
 */
export function periodLabel(period: number | null): string | null {
  if (period === null || !Number.isFinite(period) || period < 1) return null
  if (period <= 4) return `Q${period}`
  return period === 5 ? 'OT' : `${period - 4}OT`
}
