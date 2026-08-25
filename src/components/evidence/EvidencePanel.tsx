import Link from 'next/link'

import type { MeasuredBlock } from '@/lib/artifacts'
import { num, stamp } from '@/lib/format'

/**
 * The evidence panel.
 *
 * **Deliberately not a tab.** Every percentage on this site is
 * unfalsifiable without it, and a tab is a place things go to be unread. It
 * renders below the numbers it justifies, on every page that shows a
 * forecast, and a test asserts it is present.
 *
 * It states the gap to the market rather than an accuracy, because an
 * accuracy with no benchmark is a number about the schedule, not about the
 * model. And it labels the basis: this is a historical walk-forward, not a
 * live published record, and the two are never merged.
 */
export function EvidencePanel({ measured }: { measured: MeasuredBlock | undefined }) {
  if (!measured?.available) {
    return (
      <section className="card mt-8 p-5">
        <h2 className="text-sm">Evidence</h2>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          No benchmark has been published yet
          {measured?.reason ? ` — ${measured.reason}` : ''}. Until one is,
          treat every probability on this page as unverified.
        </p>
      </section>
    )
  }

  const boot = measured.bootstrap

  return (
    <section className="card mt-8 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">Evidence</h2>
        <span className="font-numeric text-[10px] text-[var(--text-tertiary)]">
          {stamp(measured.generated_at)}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Forecaster</th>
              <th scope="col" className="numeric text-right">Brier</th>
              <th scope="col" className="numeric text-right">Gap to close</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Market (closing line)</td>
              <td className="numeric text-right">{num(measured.market_brier, 4)}</td>
              <td className="numeric text-right text-[var(--text-tertiary)]">—</td>
            </tr>
            <tr>
              <td>This model</td>
              <td className="numeric text-right">{num(measured.model_brier, 4)}</td>
              <td className="numeric text-right">
                +{num(measured.gap_to_market, 4)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Item label="Games scored" value={measured.paired_n?.toLocaleString() ?? '—'} />
        <Item label="Walk-forward n" value={measured.walk_forward_n?.toLocaleString() ?? '—'} />
        <Item label="Walk-forward Brier" value={num(measured.walk_forward_brier, 4)} />
        <Item label="Calibration error" value={num(measured.walk_forward_ece, 4)} />
      </dl>

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {measured.basis ??
          'historical walk-forward; not a live published record'}
        {' — the closing line is better'}
        {boot
          ? ` (paired bootstrap ${num(boot.mean_diff, 5)}, 95% CI [${num(
              boot.ci_low,
              5,
            )}, ${num(boot.ci_high, 5)}])`
          : ''}
        , which is the expected result for a model that carries no market
        features.{' '}
        <Link
          href="/about#benchmark"
          className="text-[var(--accent-info)] hover:underline"
        >
          Why the market is the benchmark
        </Link>
      </p>
    </section>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="numeric mt-0.5 text-sm text-[var(--text-primary)]">{value}</dd>
    </div>
  )
}
