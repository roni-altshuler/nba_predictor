import { CalibrationChart } from '@/components/charts/CalibrationChart'
import { SeasonBrierChart } from '@/components/charts/SeasonBrierChart'
import { getMarketBenchmark, getSeriesModel } from '@/lib/artifacts'
import { num, pct, stamp } from '@/lib/format'

export const metadata = { title: 'Accuracy' }
export const dynamic = 'force-static'

interface Summary {
  n: number
  brier: number
  log_loss: number
  accuracy: number
  ece: number
}

/**
 * The record.
 *
 * Two rules this page exists to hold:
 *
 * 1. **Historical and live records are never merged.** The walk-forward
 *    below is retrospective — nobody saw those numbers before those
 *    tip-offs. A live published record grows from zero and is reported
 *    separately, at whatever n it has actually reached.
 * 2. **A result that does not beat its baseline is printed as such.** The
 *    playoff-series section says plainly that nothing here significantly
 *    beats "the higher seed advances", because a section that only shows
 *    wins is an advertisement rather than a record.
 */
export default function AccuracyPage() {
  const benchmark = getMarketBenchmark() as Record<string, any> | null
  const series = getSeriesModel() as Record<string, any> | null

  if (!benchmark) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No benchmark published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">benchmark_market</code> to
          generate one.
        </p>
      </div>
    )
  }

  const paired = benchmark.paired_vs_market ?? {}
  const full = benchmark.full_corpus ?? {}
  const boot = paired.bootstrap ?? {}
  const bySeason: Record<string, any> = benchmark.by_season ?? {}

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Record</p>
        <h1 className="mt-1 text-2xl">How right has it been</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Every number below is a walk-forward: the model is refitted monthly
          on games strictly earlier than the one it is scored on. It never
          sees the game it predicts, and it never sees a later season.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-sm">Against the closing line</h2>
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecaster</th>
                <th scope="col" className="numeric text-right">Brier</th>
                <th scope="col" className="numeric text-right">Log loss</th>
                <th scope="col" className="numeric text-right">Accuracy</th>
                <th scope="col" className="numeric text-right">ECE</th>
                <th scope="col" className="numeric text-right">Gap</th>
              </tr>
            </thead>
            <tbody>
              <Row label="Market (closing line)" summary={paired.market} baseline={paired.market?.brier} highlight />
              <Row label="This model" summary={paired.model} baseline={paired.market?.brier} />
              <Row label="Elo only" summary={paired.elo_only} baseline={paired.market?.brier} />
              <Row label="Constant base rate" summary={paired.constant_base_rate} baseline={paired.market?.brier} />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          {paired.n?.toLocaleString()} games carry a price and are scored
          paired; {paired.unpriced_games?.toLocaleString()} do not and are
          excluded rather than compared against nothing. De-vig:{' '}
          {paired.devig}.
        </p>
        {boot.mean_diff !== undefined ? (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Paired bootstrap on the difference: {num(boot.mean_diff, 5)}, 95% CI
            [{num(boot.ci_low, 5)}, {num(boot.ci_high, 5)}]. The market is
            better and the interval excludes zero.{' '}
            <strong className="text-[var(--text-secondary)]">
              That is the result we expect and want.
            </strong>{' '}
            This model carries no market features; one that beat the closing
            line would be evidence of a bug in the harness, not of an edge.
          </p>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm">Does it mean what it says</h2>
        <div className="card p-4">
          <CalibrationChart buckets={(full.reliability ?? []) as any} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Calibration is the property that makes a probability usable.
          Accuracy is partly a fact about the schedule — a season of
          lopsided matchups is easier to call — but a forecaster that says
          70% and is right 70% of the time is telling the truth regardless.
          Measured error here is {num(full.model?.ece, 4)}.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm">On every game, priced or not</h2>
        <div className="card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecaster</th>
                <th scope="col" className="numeric text-right">Brier</th>
                <th scope="col" className="numeric text-right">Accuracy</th>
                <th scope="col" className="numeric text-right">ECE</th>
              </tr>
            </thead>
            <tbody>
              <SimpleRow label="This model" summary={full.model} />
              <SimpleRow label="Elo only" summary={full.elo_only} />
              <SimpleRow label="Constant base rate" summary={full.constant_base_rate} />
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
          {full.n?.toLocaleString()} games. Home teams won{' '}
          {pct(full.base_rate_home, 1)} of them, which is the number the
          constant baseline predicts every time.
        </p>
      </section>

      {Object.keys(bySeason).length ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm">Season by season</h2>
          <div className="card mb-4 p-4">
            <SeasonBrierChart
              rows={Object.entries(bySeason).map(([season, row]: [string, any]) => ({
                season: Number(season),
                model: row.paired_model?.brier ?? row.model?.brier ?? null,
                market: row.market?.brier ?? null,
              }))}
            />
          </div>
          <div className="card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col" className="numeric text-right">Games</th>
                  <th scope="col" className="numeric text-right">Model Brier</th>
                  <th scope="col" className="numeric text-right">Market Brier</th>
                  <th scope="col" className="numeric text-right">Gap</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(bySeason).map(([season, row]: [string, any]) => (
                  <tr key={season}>
                    <td className="numeric text-[var(--text-primary)]">{season}</td>
                    <td className="numeric text-right">{row.n?.toLocaleString()}</td>
                    <td className="numeric text-right">{num(row.model?.brier, 4)}</td>
                    <td className="numeric text-right">
                      {row.market ? num(row.market.brier, 4) : '—'}
                    </td>
                    <td className="numeric text-right">
                      {row.gap !== undefined ? `+${num(row.gap, 4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
            A season with no market column had no published lines in the
            source. It is shown as absent rather than filled in.
          </p>
        </section>
      ) : null}

      {series ? <SeriesSection series={series} /> : null}

      <p className="mt-6 font-numeric text-[10px] text-[var(--text-tertiary)]">
        benchmark generated {stamp(benchmark.generated_at as string)}
      </p>
    </div>
  )
}

function SeriesSection({ series }: { series: Record<string, any> }) {
  const ladder = series.ladder ?? {}
  const significance = series.significance ?? {}
  const modelVsSeed = significance.model_vs_seed_baseline ?? {}

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm">Playoff series</h2>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Forecaster</th>
              <th scope="col" className="numeric text-right">Brier</th>
              <th scope="col" className="numeric text-right">Accuracy</th>
              <th scope="col" className="numeric text-right">ECE</th>
            </tr>
          </thead>
          <tbody>
            <SimpleRow label="Coin flip" summary={ladder.coin_flip} />
            <SimpleRow label="Higher seed advances" summary={ladder.higher_seed_base_rate} />
            <SimpleRow label="Series model" summary={ladder.series_model} />
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {series.n_series} series since {series.from_season}; the higher seed
        advanced {pct(series.higher_seed_win_rate, 1)} of the time. Series
        reconstruction passes its progression check at{' '}
        {pct(series.progression_check?.rate, 1)} — every winner the resolver
        names does appear in the next round.
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        <strong className="text-[var(--text-secondary)]">
          The series model does not significantly beat &ldquo;the higher seed
          advances&rdquo;.
        </strong>{' '}
        Paired bootstrap: {num(modelVsSeed.mean_diff, 5)}, 95% CI [
        {num(modelVsSeed.ci_low, 5)}, {num(modelVsSeed.ci_high, 5)}] — the
        interval straddles zero. Three hundred series is a small corpus and
        the honest reading is that this layer has not yet earned a claim. It
        ships because its probabilities are what the bracket simulation
        consumes, and it is labelled here rather than quietly presented as a
        win.
      </p>
    </section>
  )
}

function Row({
  label,
  summary,
  baseline,
  highlight,
}: {
  label: string
  summary?: Summary
  baseline?: number
  highlight?: boolean
}) {
  if (!summary) return null
  const gap =
    baseline !== undefined && !highlight ? summary.brier - baseline : null
  return (
    <tr>
      <td className={highlight ? 'text-[var(--text-primary)]' : ''}>{label}</td>
      <td className="numeric text-right">{num(summary.brier, 4)}</td>
      <td className="numeric text-right">{num(summary.log_loss, 4)}</td>
      <td className="numeric text-right">{pct(summary.accuracy, 2)}</td>
      <td className="numeric text-right">{num(summary.ece, 4)}</td>
      <td className="numeric text-right">
        {gap === null ? (
          <span className="text-[var(--text-tertiary)]">—</span>
        ) : (
          `+${num(gap, 4)}`
        )}
      </td>
    </tr>
  )
}

function SimpleRow({ label, summary }: { label: string; summary?: Summary }) {
  if (!summary) return null
  return (
    <tr>
      <td>{label}</td>
      <td className="numeric text-right">{num(summary.brier, 4)}</td>
      <td className="numeric text-right">{pct(summary.accuracy, 2)}</td>
      <td className="numeric text-right">{num(summary.ece, 4)}</td>
    </tr>
  )
}
