import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
import { cn } from '@/lib/utils'

/**
 * One chip per game on the slate, each jumping into the head-to-head
 * surface with that pairing prefilled — the fastest route from "who plays
 * tonight" to "and what if the venue were flipped". The chips carry no
 * probability of their own: the game cards above already print it, and
 * the picker they open reads the same published matchup grid.
 */
export function QuickPicks({
  games,
  className,
}: {
  games: GameForecast[]
  className?: string
}) {
  if (!games.length) return null

  return (
    <div className={className}>
      <p className="eyebrow">Quick pick · head to head</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {games.map((game) => (
          <li key={game.game_id}>
            <Link
              href={{
                pathname: '/predict',
                query: { home: game.home.abbreviation, away: game.away.abbreviation },
              }}
              aria-label={`Price ${game.away.name} at ${game.home.name}`}
              className={cn(
                'card inline-flex min-h-[40px] items-center gap-1.5 px-2.5 font-numeric text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]',
              )}
            >
              <TeamLogo
                logo={game.away.logo}
                abbreviation={game.away.abbreviation}
                name={game.away.name}
                size={18}
              />
              <span>{game.away.abbreviation}</span>
              <span className="text-[var(--text-tertiary)]">@</span>
              <TeamLogo
                logo={game.home.logo}
                abbreviation={game.home.abbreviation}
                name={game.home.name}
                size={18}
              />
              <span>{game.home.abbreviation}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
