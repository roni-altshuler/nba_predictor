import Link from 'next/link'
import { playerGameHref, type AthleteIdentity } from '@/lib/athleteIdentity'

/** A name stays visible even when the provider supplied no usable athlete ID. */
export function PlayerName({ identity, gameId, teamId, name }: {
  identity: AthleteIdentity | null
  gameId: string
  teamId: string
  name: string
}) {
  const href = identity ? playerGameHref(identity, gameId, teamId) : null
  return href ? <Link href={href} prefetch={false} className="inline-flex min-h-[36px] items-center text-[var(--accent-info)] underline decoration-[var(--border-hover)] underline-offset-4 hover:decoration-current">{name}</Link> : <span className="text-[var(--text-primary)]">{name}</span>
}
