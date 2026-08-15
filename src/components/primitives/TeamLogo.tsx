import { cn } from '@/lib/utils'

/**
 * An official NBA team mark, seated on a light plate.
 *
 * **The plate is not decoration.** NBA logos are authored for light
 * backgrounds and several of them — Brooklyn's black-and-white mark, San
 * Antonio's black spur, Memphis's navy — go effectively invisible on this
 * site's pure-black canvas. Every product of this class (ESPN, FotMob, the
 * NBA's own site) seats club marks on a light tile for exactly this reason,
 * and the hairline ring is what separates the tile from the card beneath it.
 *
 * **A missing logo falls back to the abbreviation, never to a broken image
 * or an empty box.** A three-letter code is a real answer; a grey rectangle
 * reads as a failure the reader cannot act on.
 */
export function TeamLogo({
  logo,
  abbreviation,
  name,
  size = 24,
  className,
}: {
  logo?: string | null
  abbreviation?: string | null
  name?: string | null
  size?: number
  className?: string
}) {
  const label = name || abbreviation || 'Team'

  if (!logo) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-sm bg-[var(--muted-bg)] font-numeric text-[var(--text-secondary)]',
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36) }}
        aria-label={label}
        role="img"
      >
        {(abbreviation || '?').slice(0, 3)}
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: 'var(--logo-plate)',
        boxShadow: 'inset 0 0 0 1px var(--logo-plate-ring)',
      }}
    >
      {/* Plain <img>: these are remote ESPN CDN assets at a fixed small size,
          and next/image's optimiser buys nothing at 24px while adding a
          serverless hop per logo on a page that renders thirty of them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logo}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{ width: size * 0.82, height: size * 0.82, objectFit: 'contain' }}
      />
    </span>
  )
}

/** Logo + name, the standard way a team is named in a row or a card. */
export function TeamLabel({
  logo,
  abbreviation,
  name,
  size = 20,
  showAbbreviation = false,
  className,
}: {
  logo?: string | null
  abbreviation?: string | null
  name?: string | null
  size?: number
  showAbbreviation?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <TeamLogo logo={logo} abbreviation={abbreviation} name={name} size={size} />
      <span className="truncate">{showAbbreviation ? abbreviation : name}</span>
    </span>
  )
}
