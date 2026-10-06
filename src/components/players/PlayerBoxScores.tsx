import { PlayerName } from '@/components/players/PlayerName'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import type { GameBoxScore, TeamBoxScore } from '@/lib/espn'

/* ---------------------------------------------------------- player lines */

/**
 * Every player, every column ESPN publishes, plus the three lines a reader
 * asks for first.
 *
 * **Columns come from the response, not from a list typed here.** ESPN's
 * box-score schema has changed before (the plus/minus column is not in every
 * era) and a hard-coded header would silently mislabel the whole table the
 * season it changes again. The leaders strip is computed from these same
 * parsed rows rather than from ESPN's separate `leaders` block, so the
 * headline and the table can never disagree.
 *
 * **A DNP is a row, not an omission.** Who was unavailable is a fact about
 * the game, and dropping those players makes a nine-man rotation look like a
 * choice rather than an injury list.
 */
export function PlayerBoxScores({ box, enableProfiles = true }: { box: GameBoxScore; enableProfiles?: boolean }) {
  return (
    <div id="player-box-scores" className="mb-6 scroll-mt-20 space-y-6">
      {box.teams.map((team) => (
        <TeamPlayers key={team.teamId} team={team} gameId={box.gameId} enableProfiles={enableProfiles} />
      ))}
    </div>
  )
}

function TeamPlayers({ team, gameId, enableProfiles }: { team: TeamBoxScore; gameId: string; enableProfiles: boolean }) {
  const played = team.players.filter((p) => !p.didNotPlay)
  const out = team.players.filter((p) => p.didNotPlay)

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-sm">
          <TeamLogo
            logo={team.logo}
            abbreviation={team.abbreviation}
            name={team.displayName}
            size={24}
          />
          {team.displayName ?? team.abbreviation}
        </h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {team.leaders.map((leader) => (
            <span key={leader.label} className="text-[11px]">
              <span className="text-[var(--text-tertiary)]">{leader.label} </span>
              <PlayerName identity={enableProfiles ? leader.identity : null} gameId={gameId} teamId={team.teamId} name={leader.fullName} />{' '}
              <span className="numeric text-[var(--text-primary)]">
                {leader.value}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Player</th>
              {team.labels.map((label) => (
                <th key={label} scope="col" className="numeric text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {played.map((player) => (
              <tr key={player.id || player.name}>
                <td className="whitespace-nowrap">
                  <PlayerName identity={enableProfiles && player.id ? { provider: player.provider, id: player.id } : null} gameId={gameId} teamId={team.teamId} name={player.name} />
                  {player.position ? (
                    <span className="ml-1.5 font-numeric text-[10px] text-[var(--text-tertiary)]">
                      {player.position}
                    </span>
                  ) : null}
                  {player.starter ? (
                    <span className="ml-1.5 font-numeric text-[9px] uppercase tracking-[0.1em] text-[var(--accent-primary)]">
                      st
                    </span>
                  ) : null}
                </td>
                {team.labels.map((label) => (
                  <td key={label} className="numeric text-right">
                    {player.stats[label] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
            {Object.keys(team.totals).length ? (
              <tr>
                <td className="text-[var(--text-secondary)]">Team</td>
                {team.labels.map((label) => (
                  <td
                    key={label}
                    className="numeric text-right text-[var(--text-primary)]"
                  >
                    {team.totals[label] ?? '—'}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {out.length ? (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Did not play:{' '}
          {out.map((p, i) => <span key={p.id || p.name}>{i ? ' · ' : ''}<PlayerName identity={enableProfiles && p.id ? { provider: p.provider, id: p.id } : null} gameId={gameId} teamId={team.teamId} name={p.name} />{p.reason ? ` (${p.reason})` : ''}</span>)}
        </p>
      ) : null}
    </section>
  )
}
