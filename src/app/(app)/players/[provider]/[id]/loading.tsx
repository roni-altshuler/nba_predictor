export default function PlayerLoading() {
  return (
    <div aria-busy="true" aria-label="Loading player profile">
      <p role="status" className="mb-4 font-numeric text-xs text-[var(--text-secondary)]">Loading player game line…</p>
      <div className="card flex items-center gap-4 p-4 sm:gap-5 sm:p-6">
        <div className="skeleton-shimmer h-20 w-20 shrink-0 rounded-sm sm:h-32 sm:w-32" />
        <div className="min-w-0 flex-1">
          <div className="skeleton-shimmer h-6 w-3/4 rounded-sm" />
          <div className="skeleton-shimmer mt-4 h-3 w-1/2 rounded-sm" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map(key => (
          <div key={key} className="card p-4">
            <div className="skeleton-shimmer h-3 w-12 rounded-sm" />
            <div className="skeleton-shimmer mt-4 h-6 w-10 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  )
}
