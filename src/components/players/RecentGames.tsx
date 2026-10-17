import Link from 'next/link'

import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { PowerRating } from '@/lib/artifacts'
import { providerId } from '@/lib/athleteIdentity'
import type { GameContext, Meeting } from '@/lib/history'

/** Deduplicate published final results; never infer players, scores or freshness. */
export function latestCompletedGames(context: GameContext | null): Meeting[] {
  const games = new Map<string, Meeting>()
  for (const rows of Object.values(context?.head_to_head ?? {})) {
    if (!Array.isArray(rows)) continue
    for (const game of rows) {
      if (!game || typeof game.id !== 'string' || !providerId(game.id) || typeof game.date !== 'string' || !Number.isFinite(Date.parse(game.date)) ||
          typeof game.home !== 'string' || !game.home || typeof game.away !== 'string' || !game.away || game.home === game.away ||
          !Number.isInteger(game.home_score) || game.home_score < 0 || !Number.isInteger(game.away_score) || game.away_score < 0 || game.home_score === game.away_score) continue
      games.set(game.id, game)
    }
  }
  return [...games.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id)).slice(0, 3)
}

export function RecentGames({ context, teams }: { context: GameContext | null; teams: PowerRating[] }) {
  const games = latestCompletedGames(context)
  const byAbbr = new Map(teams.map(team => [team.abbreviation, team]))
  return <section id="home-players" aria-labelledby="home-players-title" className="mb-8 scroll-mt-20">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="home-players-title" className="text-sm">Players &amp; box scores</h2>
      <Link href="/seasons" className="inline-flex min-h-[44px] items-center font-numeric text-xs text-[var(--accent-info)] underline underline-offset-4">Browse completed seasons →</Link>
    </div>
    <p className="mb-3 text-xs text-[var(--text-secondary)]">Start with the last completed games in the archive. Player lines are available when ESPN supplies them.</p>
    {games.length ? <div className="grid gap-3 lg:grid-cols-3">
      {games.map(game => <Link key={game.id} href={`/games/${game.id}#player-box-scores`} prefetch={false} className="card block p-4">
        <p className="mb-3 font-numeric text-[10px] text-[var(--text-tertiary)]">Final · {new Date(game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}</p>
        {[game.away, game.home].map((abbr, index) => { const team = byAbbr.get(abbr); return <div key={abbr} className="flex min-h-[38px] items-center gap-2">
          <span aria-hidden="true" className="inline-flex shrink-0"><TeamLogo logo={team?.logo} abbreviation={abbr} name={team?.name ?? abbr} size={26} /></span>
          <span className="min-w-0 flex-1 text-sm">{team?.name ?? abbr}</span>{' '}<span className="numeric text-lg">{index ? game.home_score : game.away_score}</span>
        </div> })}
        <span className="mt-3 block border-t border-[var(--border-color)] pt-3 font-numeric text-xs text-[var(--accent-info)]">Players &amp; box score →</span>
      </Link>)}
    </div> : <div className="card p-4 text-sm text-[var(--text-secondary)]">Completed games are unavailable in this archive. Browse completed seasons to check coverage.</div>}
  </section>
}
