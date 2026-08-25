'use client'

import Link from 'next/link'

/**
 * The app-wide error boundary. Before it existed, a failed request-time
 * fetch (ESPN, for an uncached archived game) rendered nothing at all.
 * Honest and small: say it broke, offer retry, offer home.
 */
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="card mx-auto mt-12 max-w-md p-6 text-center">
      <p className="eyebrow">Something broke</p>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        This page failed to load. Usually that is a source feed timing out,
        and trying again fixes it.
      </p>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-[36px] rounded-sm border border-[var(--border-color)] px-4 font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)]"
        >
          Try again
        </button>
        <Link
          href="/"
          className="min-h-[36px] rounded-sm px-4 py-2 font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--accent-info)] hover:underline"
        >
          Today&apos;s slate
        </Link>
      </div>
    </div>
  )
}
