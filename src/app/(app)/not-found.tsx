import Link from 'next/link'

/**
 * In-shell 404 — an unknown game id or team abbreviation lands here with the
 * navigation intact, rather than on a bare default page.
 */
export default function NotFound() {
  return (
    <div className="card mx-auto mt-12 max-w-md p-6 text-center">
      <p className="eyebrow">Not found</p>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Nothing lives at this address. The schedule and the archive hold
        every game this site knows about.
      </p>
      <div className="mt-5 flex items-center justify-center gap-4">
        <Link
          href="/games"
          className="font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--accent-info)] hover:underline"
        >
          Schedule
        </Link>
        <Link
          href="/seasons"
          className="font-numeric text-[11px] uppercase tracking-[0.1em] text-[var(--accent-info)] hover:underline"
        >
          Season archive
        </Link>
      </div>
    </div>
  )
}
