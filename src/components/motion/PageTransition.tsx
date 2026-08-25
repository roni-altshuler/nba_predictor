'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { usePathname } from 'next/navigation'

import { pageVariants } from '@/lib/motion'

/**
 * Route transition, mounted once in the shell around `{children}`.
 *
 * Enter-only, keyed on the pathname: each navigation fades and rises the new
 * page into place. There is no exit animation on purpose — an exit blocks the
 * navigation the reader just asked for, and 200ms of a page they have already
 * left is chrome, not feedback.
 *
 * Under `prefers-reduced-motion` this renders static markup — the same rule
 * every motion component in the sibling projects follows.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const reduced = useReducedMotion()

  if (reduced) return <>{children}</>

  return (
    <motion.div
      key={pathname}
      initial="hidden"
      animate="visible"
      variants={pageVariants}
    >
      {children}
    </motion.div>
  )
}
