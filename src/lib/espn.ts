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

/** A day. Box scores are final within minutes of a game and never change. */
const REVALIDATE_SECONDS = 86_400

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
  let payload: any
  try {
    const response = await fetch(`${SUMMARY}?event=${encodeURIComponent(gameId)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    payload = await response.json()
  } catch {
    return null
  }

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
