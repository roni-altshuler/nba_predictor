'use client'

import { GameCard } from '@/components/forecast/GameCard'
import { CompactGameCard } from '@/components/forecast/CompactGameCard'
import type { GameForecast } from '@/lib/artifacts'
import { useLiveScores } from './LiveScores'

/**
 * Server-selected games with the existing confirmed-score overlay. Compact
 * homepage rows keep forecasts in native disclosures; the default card keeps
 * its full forecast visible. Neither variant invents games or changes the poll.
 */
export function LiveSlate({ games, compact = false }: { games: GameForecast[]; compact?: boolean }) {
  const live = useLiveScores(
    games.map((game) => ({ id: game.game_id, dateUtc: game.date_utc })),
  )

  return (
    <div className={`grid gap-3 ${compact ? 'xl:grid-cols-3' : 'md:grid-cols-2'}`}>
      {games.map((game) => (
        compact ? <CompactGameCard key={game.game_id} game={game} live={live[game.game_id]} />
          : <GameCard key={game.game_id} game={game} live={live[game.game_id]} />
      ))}
    </div>
  )
}
