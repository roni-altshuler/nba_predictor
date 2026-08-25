'use client'

import { motion, useReducedMotion } from 'framer-motion'

/**
 * The LIVE pill: the three `--live-*` tokens that have sat in the palette
 * since the day it was written, finally earning their keep.
 *
 * Colour carries meaning only, and this is a meaning: red is the live
 * signal across the sibling projects. The word is always in the pill —
 * never the dot alone — because colour-only state is forbidden here for
 * the same reason a probability is never a bar without a number.
 *
 * The dot pulses slowly on the motion path and sits static under
 * `prefers-reduced-motion`. Opacity only — no scale, no glow, no shadow;
 * Bugatti does not blink at people.
 */
export function LiveBadge({ label = 'Live' }: { label?: string }) {
  const reduced = useReducedMotion()
  const dot = 'h-1.5 w-1.5 rounded-full bg-[var(--live-text)]'

  return (
    <span
      data-live-badge
      className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-[var(--live-border)] bg-[var(--live-bg)] px-1.5 py-0.5 font-numeric text-[10px] uppercase tracking-[0.14em] text-[var(--live-text)]"
    >
      {reduced ? (
        <span className={dot} aria-hidden="true" />
      ) : (
        <motion.span
          className={dot}
          aria-hidden="true"
          animate={{ opacity: [1, 0.25, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {label}
    </span>
  )
}
