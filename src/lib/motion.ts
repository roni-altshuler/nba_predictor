import type { Transition, Variants } from 'framer-motion'

/**
 * Shared motion vocabulary, ported from the sibling Pitchverse project.
 *
 * One easing curve and a small set of variants used across the app so every
 * surface animates with the same physics. Components import these instead of
 * hand-rolling transitions, which keeps the motion language consistent and
 * makes a global tuning pass a one-file change.
 *
 * All consumers must gate big/continuous motion behind `useReducedMotion()` —
 * these variants only describe the "motion on" path.
 */

/** The house easing — a confident overshoot-free ease-out. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const
/** Snappier ease for small interactive elements (chips, toggles). */
export const EASE_SNAP = [0.16, 1, 0.3, 1] as const

export const springSoft: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.9,
}

export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 32,
}

/** Page / route transition — used by <PageTransition>. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: EASE_OUT },
  },
}

/** Container that staggers its children in on mount. */
export const staggerContainer = (stagger = 0.06, delay = 0): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
})

/** Single staggered child — fades and rises into place. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } },
}
