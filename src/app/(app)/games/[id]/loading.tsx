/**
 * Request-time matchups may wait for an archived box score or injury report.
 *
 * The boxes mirror the real layout — eyebrow, the two-team header, the
 * probability strip, then two content cards — so nothing jumps when the page
 * arrives.
 */
export default function GameLoading() {
  return (
    <div aria-busy="true" aria-label="Loading game">
      <p role="status" className="mb-3 font-numeric text-xs text-[var(--text-secondary)]">Loading matchup…</p>
      <div className="skeleton-shimmer h-3 w-40 rounded-sm" />
      <div className="card mt-4 p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="skeleton-shimmer h-10 w-10 rounded-sm" />
            <div className="skeleton-shimmer h-4 w-14 rounded-sm sm:w-28" />
          </div>
          <div className="skeleton-shimmer h-6 w-16 rounded-sm" />
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
            <div className="skeleton-shimmer h-4 w-14 rounded-sm sm:w-28" />
            <div className="skeleton-shimmer h-10 w-10 rounded-sm" />
          </div>
        </div>
        <div className="skeleton-shimmer mt-5 h-1 w-full rounded-sm" />
      </div>
      <div className="card mt-4 p-5">
        <div className="skeleton-shimmer h-3 w-32 rounded-sm" />
        <div className="skeleton-shimmer mt-4 h-24 w-full rounded-sm" />
      </div>
      <div className="card mt-4 p-5">
        <div className="skeleton-shimmer h-3 w-32 rounded-sm" />
        <div className="skeleton-shimmer mt-4 h-40 w-full rounded-sm" />
      </div>
    </div>
  )
}
