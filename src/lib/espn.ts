/**
 * Player box scores, read from ESPN at request time.
 *
 * **Deliberately NOT in the warehouse.** The warehouse holds what the model
 * consumes: results, team totals, prices. Player lines are 31,844 games times
 * thirty-odd athletes — hundreds of megabytes of JSON that no forecast reads,
 * committed to a repository, to render a page nobody may open. This fetch is
 * scoped to the one game a reader asked for, cached for a day, and stays out
 * of the model's data path entirely.
 *
 * **`site.web.api.espn.com`, never `site.api`.** The latter is fronted by an
 * Akamai config that 403s datacentre IPs and returns no CORS headers, so the
 * failure appears only in deployment and looks like a bug in this code. That
 * lesson is written down in CLAUDE.md and re-stated here because this is a
 * new call site.
 *
 * **A failure returns null, and the page says the box score is unavailable.**
 * It never blocks the parts of the page that come from our own artifacts: the
 * forecast, the quarters and the result are ours, and an ESPN outage must not
 * take them down with it.
 */

const SUMMARY =
  'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary'
const TEAMS =
  'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams'

/** A day. Box scores are final within minutes of a game and never change. */
const REVALIDATE_SECONDS = 86_400

/**
 * Hard ceiling on any single ESPN request.
 *
 * **A build must never be able to hang on somebody else's server.** Without
 * this, a slow ESPN turns `next build` into a 60-second-per-page timeout and
 * three retries of it — which is what happened the first time the injuries
 * call was added to the prerender path, on 60 upcoming-game pages at once.
 * Eight seconds is generous for a JSON document and short enough that sixty
 * consecutive failures still finish inside a normal build.
 *
 * The failure mode is already correct everywhere this is used: a timeout is
 * an aborted fetch, an aborted fetch throws, and every reader here catches
 * and returns null or an empty list. The page then says the data is
 * unavailable, which is true.
 */
const TIMEOUT_MS = 8_000

/**
 * One summary fetch, shared by every consumer of it on this page.
 *
 * The box score and the win probability curve come from the same document.
 * Next dedupes identical `fetch` calls within a render pass, so calling this
 * twice on one page is one request — but only if the URL and options match
 * exactly, which is why there is one function rather than two call sites
 * that happen to agree today.
 */
async function summary(gameId: string): Promise<any | null> {
  try {
    const response = await fetch(`${SUMMARY}?event=${encodeURIComponent(gameId)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export interface PlayerLine {
  id: string
  name: string
  shortName: string
  position: string | null
  jersey: string | null
  starter: boolean
  didNotPlay: boolean
  reason: string | null
  /** Keyed by ESPN's own column name: MIN, PTS, FG, 3PT, REB, AST, … */
  stats: Record<string, string>
}

export interface TeamBoxScore {
  teamId: string
  abbreviation: string | null
  displayName: string | null
  logo: string | null
  /** Column order exactly as ESPN publishes it. */
  labels: string[]
  players: PlayerLine[]
  totals: Record<string, string>
  leaders: Array<{ label: string; player: string; value: string }>
}

export interface GameBoxScore {
  gameId: string
  teams: TeamBoxScore[]
}

/* The three lines a reader asks for first. Derived from the box score we
   already parsed rather than from ESPN's separate `leaders` block, which is
   a second source for the same fact and can disagree with the table printed
   directly beneath it. */
const LEADER_COLUMNS: Array<[string, string]> = [
  ['PTS', 'Points'],
  ['REB', 'Rebounds'],
  ['AST', 'Assists'],
]

export async function getEspnBoxScore(
  gameId: string,
): Promise<GameBoxScore | null> {
  const payload = await summary(gameId)
  const blocks = payload?.boxscore?.players
  if (!Array.isArray(blocks) || !blocks.length) return null

  const teams: TeamBoxScore[] = []
  for (const block of blocks) {
    const statistics = block?.statistics?.[0]
    const labels: string[] = Array.isArray(statistics?.names)
      ? statistics.names
      : []
    if (!labels.length) continue

    const players: PlayerLine[] = (statistics.athletes ?? []).map(
      (entry: any) => ({
        id: String(entry?.athlete?.id ?? ''),
        name: entry?.athlete?.displayName ?? 'Unknown',
        shortName: entry?.athlete?.shortName ?? entry?.athlete?.displayName ?? '',
        position: entry?.athlete?.position?.abbreviation ?? null,
        jersey: entry?.athlete?.jersey ?? null,
        starter: Boolean(entry?.starter),
        didNotPlay: Boolean(entry?.didNotPlay),
        reason: entry?.reason ?? null,
        stats: zip(labels, entry?.stats),
      }),
    )

    teams.push({
      teamId: String(block?.team?.id ?? ''),
      abbreviation: block?.team?.abbreviation ?? null,
      displayName: block?.team?.displayName ?? null,
      logo: block?.team?.logo ?? null,
      labels,
      players,
      totals: zip(labels, statistics?.totals),
      leaders: leadersFrom(players),
    })
  }

  return teams.length ? { gameId, teams } : null
}

function zip(labels: string[], values: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(values)) return out
  labels.forEach((label, i) => {
    const value = values[i]
    if (value !== undefined && value !== null && value !== '') {
      out[label] = String(value)
    }
  })
  return out
}

/* ------------------------------------------------------ win probability */

export interface WinProbabilityPoint {
  /** ESPN's own play index — monotone, and the only ordering it publishes. */
  sequence: number
  /** Home win probability at that moment, 0–1. */
  homeWinPercentage: number
  /** Score after the play, when ESPN carries it. */
  homeScore: number | null
  awayScore: number | null
  period: number | null
  clock: string | null
}

export interface WinProbability {
  gameId: string
  points: WinProbabilityPoint[]
  /** The single largest single-play swing, which is the story of the game. */
  biggestSwing: {
    delta: number
    toward: 'home' | 'away'
    from: number
    to: number
    period: number | null
    clock: string | null
  } | null
  /** How far the home side fell before winning. Null when they lost. */
  comebackFrom: number | null
}

/**
 * ESPN's in-game win probability curve, for a game that has finished.
 *
 * **This is ESPN's number, not ours, and the page says so.** It is a
 * different model with different inputs — time, score and possession, none
 * of which this project's forecaster has ever seen. Rendering it beside our
 * pre-game probability is a comparison of two things that answer different
 * questions, and conflating them would put a number on the accuracy page
 * that no benchmark here produced.
 *
 * It earns its place because the game page already prints a running score
 * per quarter, and "when it got away from them" is a shape rather than a
 * sentence. The curve is what a reader arriving from a search result expects
 * to find and is the last thing on this page that was missing.
 *
 * Fetched at request time and cached for a day, on the same terms and for
 * the same reasons as the box score above: it is not model input, so it does
 * not belong in the warehouse.
 */
export async function getEspnWinProbability(
  gameId: string,
): Promise<WinProbability | null> {
  const payload = await summary(gameId)
  const raw = payload?.winprobability
  if (!Array.isArray(raw) || raw.length < 2) return null

  const points: WinProbabilityPoint[] = []
  for (const entry of raw) {
    // `Number(null)` is 0, and 0 is a legal probability — so a null entry
    // coerced through Number() draws a hard spike to the floor and reads as
    // "the home team had no chance at that moment". Rejected before the
    // conversion, not after it.
    const value = entry?.homeWinPercentage
    if (value === null || value === undefined || value === '') continue
    const p = Number(value)
    if (!Number.isFinite(p) || p < 0 || p > 1) continue
    points.push({
      sequence: Number(entry?.playId ?? entry?.sequenceNumber ?? points.length),
      homeWinPercentage: p,
      homeScore: numberOrNull(entry?.homeScore),
      awayScore: numberOrNull(entry?.awayScore),
      period: numberOrNull(entry?.period?.number ?? entry?.period),
      clock: entry?.clock?.displayValue ?? null,
    })
  }
  if (points.length < 2) return null

  return {
    gameId,
    points,
    biggestSwing: biggestSwing(points),
    comebackFrom: comebackFrom(points),
  }
}

function biggestSwing(points: WinProbabilityPoint[]): WinProbability['biggestSwing'] {
  let best: WinProbability['biggestSwing'] = null
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1].homeWinPercentage
    const to = points[i].homeWinPercentage
    const delta = Math.abs(to - from)
    if (!best || delta > best.delta) {
      best = {
        delta,
        toward: to > from ? 'home' : 'away',
        from,
        to,
        period: points[i].period,
        clock: points[i].clock,
      }
    }
  }
  return best
}

/**
 * The low-water mark of the side that ended up winning.
 *
 * Returned as the winner's own lowest probability, so the caller does not
 * have to know which side that was. Null when the curve never dipped below
 * even money for them — a game nobody came back in.
 */
function comebackFrom(points: WinProbabilityPoint[]): number | null {
  const final = points[points.length - 1].homeWinPercentage
  const homeWon = final >= 0.5
  let lowest = 1
  for (const point of points) {
    const forWinner = homeWon
      ? point.homeWinPercentage
      : 1 - point.homeWinPercentage
    if (forWinner < lowest) lowest = forWinner
  }
  return lowest < 0.5 ? lowest : null
}

/* -------------------------------------------------------------- injuries */

export interface InjuryEntry {
  player: string
  position: string | null
  status: string
  detail: string | null
  date: string | null
}

export interface TeamInjuries {
  teamId: string
  abbreviation: string | null
  displayName: string | null
  entries: InjuryEntry[]
}

/**
 * Who is unavailable, as ESPN reports it right now.
 *
 * **Nothing here adjusts a probability, and that is a deliberate limit
 * rather than an unfinished feature.** The model knows nothing about who is
 * playing; this is the single largest gap in it and CLAUDE.md says so. The
 * temptation on seeing an injury list is to reach for a rating adjustment,
 * and it must be resisted here for a reason that is not squeamishness:
 * **ESPN's injury endpoint is a snapshot of today with no historical
 * archive**, so an availability-adjusted rating cannot be walk-forward
 * tested against this corpus at all. It could only be validated forward,
 * from zero, over years. A number this project cannot benchmark is a number
 * it does not publish.
 *
 * So this is descriptive: it is shown, sourced and timestamped, next to a
 * forecast that explicitly has not read it. That is the honest version, and
 * it is also the thing a reader actually wants before an 8pm tip.
 *
 * Cached for an hour rather than a day — an injury report changes on the
 * afternoon of the game, which is exactly when it is worth reading. Note
 * that the game route sets its own `revalidate`, so a page already built
 * will not be fresher than that; the caption on the page says the report is
 * as of the last rebuild rather than claiming a frequency this cannot
 * guarantee.
 */
const INJURIES_REVALIDATE_SECONDS = 3_600

export async function getEspnInjuries(
  teamAbbreviations: string[],
): Promise<TeamInjuries[]> {
  let payload: any
  try {
    const response = await fetch(`${TEAMS}/injuries`, {
      next: { revalidate: INJURIES_REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return []
    payload = await response.json()
  } catch {
    return []
  }

  const wanted = new Set(teamAbbreviations.filter(Boolean).map((a) => a.toUpperCase()))
  const out: TeamInjuries[] = []

  for (const block of payload?.injuries ?? []) {
    const abbreviation: string | null = block?.abbreviation ?? null
    if (wanted.size && (!abbreviation || !wanted.has(abbreviation.toUpperCase()))) {
      continue
    }
    const entries: InjuryEntry[] = []
    for (const entry of block?.injuries ?? []) {
      const player = entry?.athlete?.displayName
      const status = entry?.status
      if (!player || !status) continue
      entries.push({
        player,
        position: entry?.athlete?.position?.abbreviation ?? null,
        status: String(status),
        detail:
          entry?.details?.type ??
          entry?.shortComment ??
          entry?.type?.description ??
          null,
        date: entry?.date ?? null,
      })
    }
    if (!entries.length) continue
    out.push({
      teamId: String(block?.id ?? ''),
      abbreviation,
      displayName: block?.displayName ?? null,
      entries: entries.sort(byStatusSeverity),
    })
  }
  return out
}

/* Out before Doubtful before Questionable before Day-To-Day. A reader
   scanning this strip is looking for who is definitely missing; an
   alphabetical list buries that under whoever has an early surname. */
const STATUS_ORDER = ['out', 'suspension', 'doubtful', 'questionable', 'day-to-day']

function byStatusSeverity(a: InjuryEntry, b: InjuryEntry): number {
  const rank = (entry: InjuryEntry) => {
    const key = entry.status.toLowerCase().replace(/\s+/g, '-')
    const index = STATUS_ORDER.indexOf(key)
    return index === -1 ? STATUS_ORDER.length : index
  }
  return rank(a) - rank(b) || a.player.localeCompare(b.player)
}

function numberOrNull(value: unknown): number | null {
  const out = Number(value)
  return Number.isFinite(out) ? out : null
}

/**
 * The top line in each headline category.
 *
 * Ties are reported as the first player in ESPN's order rather than as a
 * list: a leader row is a headline, and "A, B and C with 8 assists" in a
 * three-column strip wraps into something nobody reads. The full table
 * beneath it carries every number, so nothing is hidden — only ranked.
 */
function leadersFrom(players: PlayerLine[]): TeamBoxScore['leaders'] {
  const out: TeamBoxScore['leaders'] = []
  for (const [column, label] of LEADER_COLUMNS) {
    let best: { player: PlayerLine; value: number } | null = null
    for (const player of players) {
      if (player.didNotPlay) continue
      const raw = player.stats[column]
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      if (!best || value > best.value) best = { player, value }
    }
    if (best && best.value > 0) {
      out.push({
        label,
        player: best.player.shortName || best.player.name,
        value: String(best.value),
      })
    }
  }
  return out
}
