'use client'

import { GameCard } from '@/components/forecast/GameCard'
import type { GameForecast } from '@/lib/artifacts'
import { useLiveScores } from './LiveScores'

/**
 * The home page's "next slate" grid, as a client island.
 *
 * The server still decides WHICH games are here — this component takes the
 * server-fetched forecasts as serialisable props and renders the exact
 * markup the server-side map used to, so before hydration (and forever, in
 * the offseason) the page is byte-for-byte what it was. What hydration
 * adds is the scoreboard poll: when a game on this slate goes live, its
 * card gets the score overlaid on top of the forecast it already carries.
 *
 * That is the whole feature — watching the forecast meet reality — and it
 * is why the forecast line never disappears behind the score.
 */
export function LiveSlate({ games }: { games: GameForecast[] }) {
  const live = useLiveScores(
    games.map((game) => ({ id: game.game_id, dateUtc: game.date_utc })),
  )

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {games.map((game) => (
        <GameCard key={game.game_id} game={game} live={live[game.game_id]} />
      ))}
    </div>
  )
}
