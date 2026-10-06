'use client'

import { useState } from 'react'
import { permittedAthleteImage, type AthleteIdentity, type AthleteImageAsset } from '@/lib/athleteIdentity'

/** Decorative: the full athlete name is always visible in the adjacent heading. */
export function AthletePortrait({ identity, name, jersey, asset = null }: {
  identity: AthleteIdentity
  name: string | null
  jersey: string | null
  asset?: AthleteImageAsset | null
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const permitted = permittedAthleteImage(identity, asset ? [asset] : [])
  const initials = name?.trim().split(/\s+/).filter(Boolean).map(part => Array.from(part)[0]).filter(Boolean).slice(0, 2).join('') || '—'
  return (
    <div aria-hidden="true" className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[var(--border-hover)] bg-[var(--muted-bg)] sm:h-32 sm:w-32">
      {permitted && failedSrc !== permitted.src ? (
        // Permission and subject checked above; no CDN URLs are synthesized.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={permitted.src} alt="" width={128} height={128} className="h-full w-full object-cover" onError={() => setFailedSrc(permitted.src)} />
      ) : <span className="font-numeric text-3xl font-semibold text-[var(--text-secondary)] sm:text-4xl">{initials}</span>}
      {jersey ? <span className="absolute bottom-0 right-0 border-l border-t border-[var(--border-hover)] bg-[var(--card-bg)] px-2 py-1 font-numeric text-xs">#{jersey}</span> : null}
    </div>
  )
}
