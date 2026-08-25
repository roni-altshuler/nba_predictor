import { cn } from '@/lib/utils'

/**
 * The one stat tile: an eyebrow label over a mono/tabular value.
 *
 * This exact shape had been redefined locally nine times — `Tile`, `Stat`,
 * `Item`, `Figure` — with drifting semantics: some copies were `<p>/<p>`,
 * some `<dt>/<dd>`, for identical pixels. One primitive, two semantic modes:
 *
 * - Default: a `<div>` with `<p>`s, for a grid of tiles.
 * - `dl`: a `<div>` wrapping `<dt>/<dd>`, for use INSIDE a `<dl>` — the
 *   wrapper div is valid `<dl>` content per the HTML spec.
 *
 * Everything visual beyond the base (a card surface, a larger value) is
 * composition, not props-for-one-consumer: pass `className="card p-3"` for
 * the card variant, and `valueClassName` to REPLACE the default
 * `mt-0.5 text-sm` spacing/size pair — replaced rather than merged, so two
 * margin utilities never fight over the same box.
 */
export function StatTile({
  label,
  children,
  hint,
  dl = false,
  className,
  valueClassName,
}: {
  /** The eyebrow line above the value. */
  label: React.ReactNode
  /** The value, rendered `.numeric` in `--text-primary`. */
  children: React.ReactNode
  /** Optional small tertiary line under the value. */
  hint?: React.ReactNode
  /** Render `<dt>/<dd>` for use inside a `<dl>`. */
  dl?: boolean
  /** Extra wrapper classes, e.g. `card p-3`. */
  className?: string
  /** Replaces the default `mt-0.5 text-sm` on the value, e.g. `mt-1 text-lg`. */
  valueClassName?: string
}) {
  const valueClasses = cn(
    'numeric text-[var(--text-primary)]',
    valueClassName ?? 'mt-0.5 text-sm',
  )
  const hintClasses = 'mt-1 text-[10px] leading-snug text-[var(--text-tertiary)]'

  if (dl) {
    return (
      <div className={className}>
        <dt className="eyebrow">{label}</dt>
        <dd className={valueClasses}>
          {children}
          {hint !== undefined ? (
            <span className={cn('block', hintClasses)}>{hint}</span>
          ) : null}
        </dd>
      </div>
    )
  }

  return (
    <div className={className}>
      <p className="eyebrow">{label}</p>
      <p className={valueClasses}>{children}</p>
      {hint !== undefined ? <p className={hintClasses}>{hint}</p> : null}
    </div>
  )
}
