'use client'

import { usePathname } from 'next/navigation'

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

  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  )
}
