import { pct } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * A two-sided win-probability bar.
 *
 * **The number is always text, never colour alone.** A reader cannot read
 * 63% off a bar, and a colour-blind reader cannot read it off a hue. The bar
 * is an aid to comparison; the text is the claim.
 */
export function ProbabilityBar({
  homeLabel,
  awayLabel,
  pHome,
  className,
}: {
  homeLabel: string
  awayLabel: string
  pHome: number
  className?: string
}) {
  const pAway = 1 - pHome
  const homeFavoured = pHome >= 0.5

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="truncate text-xs text-[var(--text-secondary)]">
          {awayLabel}
        </span>
        <span className="truncate text-xs text-[var(--text-secondary)]">
          {homeLabel}
        </span>
      </div>
      <div
        className="prob-track flex"
        role="img"
        aria-label={`${awayLabel} ${pct(pAway)}, ${homeLabel} ${pct(pHome)}`}
      >
        <div
          className="prob-segment h-full"
          style={{
            width: `${pAway * 100}%`,
            background: homeFavoured
              ? 'var(--muted-bg)'
              : 'var(--accent-primary)',
          }}
        />
        <div
          className="prob-segment h-full"
          style={{
            width: `${pHome * 100}%`,
            background: homeFavoured
              ? 'var(--accent-primary)'
              : 'var(--muted-bg)',
          }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <span
          className={cn(
            'numeric text-sm',
            !homeFavoured
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)]',
          )}
        >
          {pct(pAway)}
        </span>
        <span
          className={cn(
            'numeric text-sm',
            homeFavoured
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)]',
          )}
        >
          {pct(pHome)}
        </span>
      </div>
    </div>
  )
}
