/** Shared formatters. One place a number becomes a string. */

/**
 * A probability as text.
 *
 * **Never colour-only.** Every probability rendered on this site appears as
 * text, because a reader cannot read 63% off a bar and a colour-blind reader
 * cannot read it off a hue.
 */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

/** A signed number, with the sign always shown. */
export function signed(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

export function num(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

/** American moneyline, with the sign a bettor expects. */
export function moneyline(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value > 0 ? `+${Math.round(value)}` : `${Math.round(value)}`
}

/** A point spread from the home side's perspective. */
export function spread(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (value === 0) return 'PK'
  return value > 0 ? `+${value}` : `${value}`
}

export function gameDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York',
  })
}

export function gameTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET'
}

export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function stamp(iso: string | undefined): string {
  if (!iso) return 'unknown'
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }) + ' UTC'
}
