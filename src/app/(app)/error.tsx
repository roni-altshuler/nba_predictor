'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

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
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <div className="card mx-auto mt-12 max-w-md p-6 text-center">
      <h1 className="text-lg">This page couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Try loading it again, or browse another published slate.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => {
            // Resetting alone reuses the failed Server Component response.
            router.refresh()
            reset()
          })}
          className="min-h-[44px] rounded-sm border border-[var(--border-color)] px-4 font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--text-primary)] transition-colors hover:border-[var(--border-hover)]"
        >
          {pending ? 'Retrying…' : 'Try again'}
        </button>
        <Link
          href="/games"
          className="inline-flex min-h-[44px] items-center rounded-sm px-4 py-2 font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--accent-info)] hover:underline"
        >
          Browse games
        </Link>
      </div>
    </div>
  )
}
