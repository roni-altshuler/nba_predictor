/**
 * Skeleton for the one route that can block on a network fetch: an archived
 * game page outside the prerendered set awaits ESPN's box score at request
 * time. Until now that was a blank tab for however long ESPN took.
 *
 * The boxes mirror the real layout — eyebrow, the two-team header, the
 * probability strip, then two content cards — so nothing jumps when the page
 * arrives.
 */
export default function GameLoading() {
  return (
    <div aria-busy="true" aria-label="Loading game">
      <div className="skeleton-shimmer h-3 w-40 rounded-sm" />
      <div className="card mt-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="skeleton-shimmer h-10 w-10 rounded-sm" />
            <div className="skeleton-shimmer h-4 w-28 rounded-sm" />
          </div>
          <div className="skeleton-shimmer h-6 w-16 rounded-sm" />
          <div className="flex items-center gap-3">
            <div className="skeleton-shimmer h-4 w-28 rounded-sm" />
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
