import Link from 'next/link'
import { AthletePortrait } from '@/components/players/AthletePortrait'
import { BackLink } from '@/components/primitives/BackLink'
import { StatTile } from '@/components/primitives/StatTile'
import { permittedAthleteImage } from '@/lib/athleteIdentity'
import type { PlayerProfile } from '@/lib/playerProfile'

const unavailableCopy = {
  context_required: 'Open a player name in a completed game’s box score to see their verified game line and team context.',
  game_not_published: 'This game is not in the published results archive. No player identity or statistics can be verified from it.',
  team_mapping_unavailable: 'This game has no verified ESPN team mapping in the archive. Its internal team IDs cannot identify an ESPN player’s team.',
  team_not_in_game: 'The selected team is not a participant in this published game. No player line is shown.',
  box_score_unavailable: 'The game result is published, but its ESPN player box score is unavailable. Try this game again later.',
  player_not_in_game: 'This ESPN athlete ID is not present for the selected team in this game’s box score. No name or statistics are inferred.',
}

const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })

export function PlayerProfileView({ profile }: { profile: PlayerProfile }) {
  const game = profile.game
  const player = profile.status === 'available' ? profile.player : null
  const portrait = permittedAthleteImage(profile.identity)
  const extraLabels = profile.status === 'available' ? profile.labels.filter(label => !['PTS', 'REB', 'AST', 'MIN'].includes(label)) : []
  const parent = game ? `/games/${game.id}#player-box-scores` : '/games'
  return (
    <article>
      <header className="mb-6">
        <BackLink href={parent} label={game ? 'Game box score' : 'Browse games'} />
        <p className="eyebrow mt-3">Player · {player ? 'final game line' : 'coverage unavailable'}</p>
        <div className="card mt-3 flex items-start gap-4 p-4 sm:items-center sm:gap-5 sm:p-6">
          <AthletePortrait identity={profile.identity} name={player?.name ?? null} jersey={player?.jersey ?? null} asset={portrait} />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl leading-tight sm:text-3xl">{player?.name ?? 'Player profile unavailable'}</h1>
            {game ? (
              <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                <p>Game-reported team · {game.team.gameReportedName ?? 'Unavailable'}</p>
                <p className="text-xs">
                  Franchise reference ·{' '}
                  {game.team.franchise.href ? <Link href={game.team.franchise.href} className="text-[var(--accent-info)] underline underline-offset-4">{game.team.franchise.name}</Link> : game.team.franchise.name}
                </p>
              </div>
            ) : null}
            {player ? (
              <p className="mt-2 font-numeric text-xs text-[var(--text-secondary)]">
                {player.position ? `Position ${player.position} · ` : ''}
                {player.jersey ? `Jersey #${player.jersey} · ` : ''}
                {player.didNotPlay ? 'Did not play' : player.starter ? 'Starter' : 'Bench'}
              </p>
            ) : null}
            <p className="mt-3 font-numeric text-[11px] text-[var(--text-tertiary)]">ESPN athlete ID {profile.identity.id}</p>
            {!portrait ? <p className="mt-1 text-xs text-[var(--text-tertiary)]">Portrait unavailable</p> : null}
          </div>
        </div>
      </header>

      {game ? (
        <section aria-labelledby="profile-game" className="mb-6">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="profile-game" className="text-sm">The selected game</h2>
            <p className="font-numeric text-[11px] text-[var(--text-tertiary)]">{date(game.date)} · final</p>
          </div>
          <Link href={parent} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <span className="font-numeric text-sm">
              {game.away}{' '}
              <span className="numeric mx-2 text-[var(--text-primary)]">{game.awayScore} – {game.homeScore}</span>
              {' '}{game.home}
            </span>
            <span className="text-xs text-[var(--accent-info)]">Game &amp; full box score →</span>
          </Link>
          <p className="mt-2 text-xs text-[var(--text-tertiary)]">Score matchup uses normalized franchise codes.</p>
        </section>
      ) : null}

      {player ? (
        <section aria-labelledby="profile-stats" className="mb-8">
          <h2 id="profile-stats" className="mb-3 text-sm">{player.didNotPlay ? 'Game availability' : 'Single-game statistics'}</h2>
          {player.didNotPlay ? (
            <div className="card p-4">
              <p className="text-sm">Did not play</p>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{player.reason ?? 'No reason published.'}</p>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {['PTS', 'REB', 'AST', 'MIN'].map(label => (
                  <StatTile dl key={label} label={{ PTS: 'Points', REB: 'Rebounds', AST: 'Assists', MIN: 'Minutes' }[label]} className="card p-4" valueClassName="mt-2 text-2xl">
                    {player.stats[label] ?? '—'}
                  </StatTile>
                ))}
              </dl>
              {extraLabels.length ? (
                <div className="card mt-3 p-4">
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                    {extraLabels.map(label => <StatTile dl key={label} label={label}>{player.stats[label] ?? '—'}</StatTile>)}
                  </dl>
                </div>
              ) : null}
            </>
          )}
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-tertiary)]">Source: ESPN final game summary. Stats describe this game only. Source update time unavailable.</p>
        </section>
      ) : (
        <section role="status" className="card mb-8 p-5">
          <h2 className="text-sm">{profile.status === 'unavailable' && profile.reason === 'context_required' ? 'Choose a completed game' : 'No verified player line'}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--text-secondary)]">{profile.status === 'unavailable' ? unavailableCopy[profile.reason] : null}</p>
          <Link href={parent} className="mt-4 inline-flex min-h-[44px] items-center text-sm text-[var(--accent-info)] hover:underline">{game ? 'Return to the game →' : 'Browse published games →'}</Link>
        </section>
      )}

      <section aria-labelledby="profile-coverage" className="mb-6">
        <h2 id="profile-coverage" className="mb-3 text-sm">Season &amp; career coverage</h2>
        <dl className="card divide-y divide-[var(--border-color)] px-4">
          {['Current roster', 'Season totals & averages', 'Career statistics'].map(label => (
            <div key={label} className="flex flex-wrap justify-between gap-2 py-4">
              <dt className="text-sm text-[var(--text-secondary)]">{label}</dt>
              <dd className="font-numeric text-xs">Unavailable</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">Franchise references use normalized names, which may be modern names for historical games. The published archive has no verified roster or career dataset. A game’s team and position do not establish current membership; partial game coverage does not establish season averages.</p>
      </section>
      {game ? <p className="text-xs text-[var(--text-tertiary)]">Results archive published {game.archivePublishedAt ? date(game.archivePublishedAt) : 'at an unavailable time'}. Player lines are read separately from ESPN.</p> : null}
    </article>
  )
}
