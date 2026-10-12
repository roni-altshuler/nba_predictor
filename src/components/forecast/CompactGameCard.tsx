import Link from 'next/link'

import { LiveBadge } from '@/components/live/LiveBadge'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameForecast } from '@/lib/artifacts'
import { periodLabel, type LiveScore } from '@/lib/espnLive'
import { gameTime, num, pct } from '@/lib/format'

/** Schedule/confirmed scores first; the existing published model stays on demand. */
export function CompactGameCard({ game, live }: { game: GameForecast; live?: LiveScore }) {
  const inPlay = live?.state === 'in'
  const finished = live?.state === 'post' && live.completed
  const haveScore = (inPlay || finished) && live!.homeScore !== null && live!.awayScore !== null
  const phase = inPlay ? [periodLabel(live!.period), live!.displayClock].filter(Boolean).join(' · ') : ''
  const favourite = game.p_home > game.p_away ? game.home : game.away
  const probability = game.p_home > game.p_away ? game.p_home : game.p_away

  return <article aria-label={`${game.away.name} at ${game.home.name}`} data-game-id={game.game_id} className="card min-w-0 p-3">
    <div className="mb-2 flex min-h-5 flex-wrap items-center justify-between gap-2 font-numeric text-[11px] text-[var(--text-secondary)]">
      {inPlay ? <span className="inline-flex items-center gap-2"><LiveBadge />{phase}</span>
        : finished ? <span>Final</span> : <span>Tip-off · {gameTime(game.date_utc)}</span>}
      {!haveScore ? <span data-score="pending">{inPlay || finished ? 'Score unavailable' : 'vs'}</span> : null}
    </div>
    <div data-score={haveScore ? finished ? 'final' : 'live' : undefined}>
      {([game.away, game.home] as const).map((team, index) => <div key={team.team_id} className="flex items-center justify-between gap-2">
        <Link href={`/teams/${team.abbreviation}`} prefetch={false} aria-label={`${team.name} team page`} className="inline-flex min-h-[44px] min-w-0 items-center gap-2 text-sm underline underline-offset-4">
          <TeamLogo logo={team.logo} name={team.name} abbreviation={team.abbreviation} size={26} />
          <span>{team.name}</span>
        </Link>
        {haveScore ? <span className="font-numeric text-base">{index ? live!.homeScore : live!.awayScore}</span> : null}
      </div>)}
    </div>
    <div className="relative mt-1 border-t border-[var(--border-color)] pt-1">
      <Link href={`/games/${game.game_id}`} prefetch={false} className="absolute right-0 top-1 inline-flex min-h-[44px] items-center font-numeric text-xs text-[var(--accent-info)] underline underline-offset-4">Matchup & players →</Link>
      <details data-model-outlook={game.game_id}>
        <summary className="min-h-[44px] w-fit cursor-pointer py-3 font-numeric text-xs text-[var(--accent-info)]">Model outlook</summary>
        <div className="pb-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          <p>{game.p_home === game.p_away ? `Even matchup · ${pct(game.p_home)} each.` : `${favourite.name} · ${pct(probability)} published win chance.`}</p>
          <p className="mt-2 font-numeric">Projected score · {game.away.abbreviation} {Math.round(game.exp_away_score)}–{game.home.abbreviation} {Math.round(game.exp_home_score)} · total {num(game.exp_total)}</p>
          <p className="mt-2">Pre-game model; these probabilities stay fixed in play. Ratings, observed form and schedule context inform the outlook. Injuries and confirmed lineups are not inputs.</p>
          <Link href={`/games/${game.game_id}#forecast`} prefetch={false} className="mt-1 inline-flex min-h-[44px] items-center text-[var(--accent-info)] underline underline-offset-4">Forecast evidence & details →</Link>
        </div>
      </details>
    </div>
  </article>
}
