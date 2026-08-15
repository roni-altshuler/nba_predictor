import Link from 'next/link'

import { getSeasonsIndex } from '@/lib/history'
import { num, stamp } from '@/lib/format'

export const metadata = { title: 'Seasons' }
export const dynamic = 'force-static'

export default function SeasonsPage() {
  const index = getSeasonsIndex()

  if (!index) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No archive published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">build_history</code> to generate one.
        </p>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Archive</p>
        <h1 className="mt-1 text-2xl">Every season since 2004</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {index.seasons.length} seasons, final standings, full results and the
          playoff bracket. Each game also carries what the model{' '}
          <em>would</em> have said — refit monthly on games strictly earlier,
          so it never saw the game it scores.
        </p>
      </header>

      <div className="card mb-6 p-4">
        <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          <strong className="text-[var(--text-secondary)]">
            Every forecast in this archive is a backtest.
          </strong>{' '}
          The model never saw the game it scores — but nobody saw these
          numbers before those tip-offs either. A reconstructed forecast is
          not a published one, and this site does not let the two blur. The
          first {index.warmup_seasons} seasons carry no forecast at all: they
          are the warm-up the model was fitted on.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Season</th>
              <th scope="col">Champion</th>
              <th scope="col">Best record</th>
              <th scope="col" className="numeric text-right">Games</th>
              <th scope="col" className="numeric text-right">Model Brier</th>
              <th scope="col" className="numeric text-right">Market Brier</th>
            </tr>
          </thead>
          <tbody>
            {index.seasons.map((season) => (
              <tr key={season.season}>
                <td>
                  <Link
                    href={`/seasons/${season.season}`}
                    className="numeric text-[var(--accent-info)] hover:underline"
                  >
                    {season.label}
                  </Link>
                </td>
                <td className="text-[var(--text-primary)]">
                  {season.champion ?? '—'}
                </td>
                <td className="text-[var(--text-secondary)]">
                  {season.best_record
                    ? `${season.best_record.team} ${season.best_record.wins}–${season.best_record.losses}`
                    : '—'}
                </td>
                <td className="numeric text-right">{season.games.toLocaleString()}</td>
                <td className="numeric text-right">
                  {season.model_brier != null ? num(season.model_brier, 4) : '—'}
                </td>
                <td className="numeric text-right">
                  {season.market_brier != null ? num(season.market_brier, 4) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
        A blank market column means no published price existed in the source
        for that season — shown as absent rather than filled in.
      </p>
      <p className="mt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
        archive generated {stamp(index.generated_at)}
      </p>
    </div>
  )
}
