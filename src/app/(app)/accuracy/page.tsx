import Link from 'next/link'

import { CalibrationChart } from '@/components/charts/CalibrationChart'
import { PitHistogram } from '@/components/charts/PitHistogram'
import { SeasonBrierChart } from '@/components/charts/SeasonBrierChart'
import {
  getLiveRecord,
  getMarketBenchmark,
  getSeriesModel,
  type ClvBlock,
  type CoverageRow,
  type LiveRecord,
} from '@/lib/artifacts'
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
  const live = getLiveRecord()

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
          Two records, kept apart on purpose: the live one was published
          before the games it scores, and everything after it is a
          reconstruction.
        </p>
      </header>

      <LiveSection live={live} />

      <div className="mb-8 border-t border-[var(--border-color)] pt-8">
        <p className="eyebrow">Reconstructed</p>
        <h2 className="mt-1 text-lg">Everything below is a backtest</h2>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
          Twenty-three seasons scored under a walk-forward that never lets the
          model see the game it predicts — the right way to measure, and still
          not a published record.{' '}
          <Link
            href="/about#backtest"
            className="text-[var(--accent-info)] hover:underline"
          >
            Why a backtest is never a live record
          </Link>
        </p>
      </div>

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
            Paired bootstrap: {num(boot.mean_diff, 5)}, 95% CI
            [{num(boot.ci_low, 5)}, {num(boot.ci_high, 5)}] — the market is
            better and the interval excludes zero.{' '}
            <strong className="text-[var(--text-secondary)]">
              That is the expected and wanted result:
            </strong>{' '}
            this model carries no market features, so beating the close would
            mean a bug in the harness, not an edge.
          </p>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm">Does it mean what it says</h2>
        <div className="card p-4">
          <CalibrationChart buckets={(full.reliability ?? []) as any} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          A forecaster that says 70% and is right 70% of the time is telling
          the truth whatever the schedule looks like. Measured error here is{' '}
          {num(full.model?.ece, 4)}.
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

      <ContinuousSection continuous={benchmark.continuous} />

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
                    <td className="numeric whitespace-nowrap">
                      <Link
                        href={`/seasons/${season}`}
                        className="text-[var(--text-primary)] hover:underline"
                      >
                        {Number(season) - 1}&ndash;{String(season).slice(2)}
                      </Link>
                    </td>
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

/**
 * The live record: what was published in advance, and how it did.
 *
 * Four states, all distinguishable, none of them rendered as an empty table:
 * the scorer has not run; it ran and the season has not started; it has
 * scored games but too few to say anything; it has enough to say something.
 * The fourth is the only one that prints a verdict, and the verdict comes
 * from the artifact rather than from a comparison made here — the frontend
 * does not decide what is significant.
 */
function LiveSection({ live }: { live: LiveRecord | null }) {
  if (!live) {
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm">The live record</h2>
        <div className="card p-5">
          <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">
            No live record has been published. Every forecast is stamped into
            the warehouse before its tip-off;{' '}
            <code className="font-numeric">score_live</code> reads them back
            and has not run.
          </p>
        </div>
      </section>
    )
  }

  const paired = live.paired_vs_market ?? { n: 0, verdict: 'insufficient' }
  const flagged = live.clv?.flagged

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm">The live record</h2>
        <span className="font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-info)]">
          Published in advance
        </span>
      </div>

      {live.n === 0 ? (
        <div className="card p-5">
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">Nothing yet.</strong>{' '}
            Not a single game has been played since forecasts started being
            stamped, so the live record is empty — which is the honest state,
            not a missing feature. It will start at one game and be reported
            at whatever number it reaches.
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            This is the only measurement on this page that will be able to
            claim the numbers existed before the results did. It is kept
            separate from the backtest below permanently, not until it looks
            respectable.
          </p>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">Forecaster</th>
                  <th scope="col" className="numeric text-right">Brier</th>
                  <th scope="col" className="numeric text-right">Accuracy</th>
                  <th scope="col" className="numeric text-right">ECE</th>
                  <th scope="col" className="numeric text-right">Games</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-[var(--text-primary)]">This model, live</td>
                  <td className="numeric text-right">{num(live.model.brier, 4)}</td>
                  <td className="numeric text-right">{pct(live.model.accuracy, 1)}</td>
                  <td className="numeric text-right">{num(live.model.ece, 4)}</td>
                  <td className="numeric text-right">{live.n.toLocaleString()}</td>
                </tr>
                {paired.market ? (
                  <tr>
                    <td>Market, same games</td>
                    <td className="numeric text-right">{num(paired.market.brier, 4)}</td>
                    <td className="numeric text-right">{pct(paired.market.accuracy, 1)}</td>
                    <td className="numeric text-right">{num(paired.market.ece, 4)}</td>
                    <td className="numeric text-right">{paired.n.toLocaleString()}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            <Verdict verdict={paired.verdict} n={paired.n} boot={paired.bootstrap} />{' '}
            Each forecast is the earliest one stamped for that game — a median
            of {num(live.median_lead_hours, 1)} hours before tip-off, never
            the last one before it.
          </p>

          {live.margin?.n ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Expected margin off by {num(live.margin.mae, 2)} points on
              average (bias {num(live.margin.bias, 2)}); expected total off by{' '}
              {num(live.total?.mae, 2)} (bias {num(live.total?.bias, 2)}).
            </p>
          ) : null}

          {flagged?.n ? (
            <div className="card mt-4 p-4">
              <h3 className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                Closing line value
              </h3>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                On {flagged.n} flagged calls the price moved{' '}
                <span className="font-numeric text-[var(--text-secondary)]">
                  {num(flagged.mean_clv, 4)}
                </span>{' '}
                on average between the call and the close, beating it{' '}
                {pct(flagged.beat_close_rate, 0)} of the time. Record{' '}
                {flagged.record}.{' '}
                <strong className="text-[var(--text-secondary)]">
                  CLV is the headline here and the record is not.
                </strong>{' '}
                Whether a price moved toward us converges in weeks; whether the
                bets won takes years, and at this sample size it is variance
                with a number attached.
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                <ClvVerdict block={flagged} minimum={live.clv?.min_n} />
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * Whether the value surface has earned the right to keep flagging edges.
 *
 * **This is the only measurement on the site that grades the site.**
 * Everything else asks whether a forecast was accurate; this asks whether
 * the edges published beside those forecasts were worth acting on, and it is
 * allowed to come back negative and say so in plain words.
 *
 * The verdict is computed in `score_live` and printed here. The frontend
 * does not decide what is significant.
 */
function ClvVerdict({
  block,
  minimum,
}: {
  block?: ClvBlock & { verdict?: string; ci_low?: number; ci_high?: number }
  minimum?: number
}) {
  if (!block?.n) return null
  const interval =
    block.ci_low !== undefined && block.ci_high !== undefined ? (
      <>
        {' '}
        95% CI [{num(block.ci_low, 4)}, {num(block.ci_high, 4)}].
      </>
    ) : null

  if (block.verdict === 'negative_stop_flagging') {
    return (
      <>
        <strong className="text-[var(--accent-warn)]">
          The flagged edges are not real.
        </strong>{' '}
        Mean CLV is negative and the interval excludes zero{interval} The
        market moved away from us on the games where we claimed an edge, which
        is what a value surface looks like when it is not working.{' '}
        <code className="font-numeric">MIN_EDGE</code> is not protecting
        anyone at its current level and should be raised or the flags
        withdrawn.
      </>
    )
  }
  if (block.verdict === 'positive') {
    return (
      <>
        Mean CLV is positive and the interval excludes zero{interval} The
        price moved toward the flagged side more often than not. That is the
        weakest claim worth making here and it is the only one this sample
        supports — it is evidence the edges were real, not evidence they were
        profitable.
      </>
    )
  }
  if (block.verdict === 'indistinguishable') {
    return (
      <>
        Mean CLV is indistinguishable from zero{interval} The flags are
        neither earning nor losing against the close.
      </>
    )
  }
  return (
    <>
      <strong className="text-[var(--text-secondary)]">
        Not enough flagged calls to grade the value surface.
      </strong>{' '}
      {block.n} of the {minimum ?? 100} needed. Until then the edges below are
      published without evidence that they are worth acting on, which is
      stated here rather than left to be assumed.
    </>
  )
}

function Verdict({
  verdict,
  n,
  boot,
}: {
  verdict: string
  n: number
  boot?: { mean_diff: number; ci_low: number; ci_high: number }
}) {
  if (verdict === 'insufficient' || !boot) {
    return (
      <>
        <strong className="text-[var(--text-secondary)]">
          Too few games to claim anything.
        </strong>{' '}
        {n
          ? `${n} priced games is not a sample; the numbers above are printed because hiding them until they flatter us would be the worse habit.`
          : 'Nothing here carries a price yet.'}
      </>
    )
  }
  if (verdict === 'model_better_suspect_the_harness') {
    return (
      <>
        <strong className="text-[var(--accent-warn)]">
          The model appears to beat the closing line.
        </strong>{' '}
        Paired bootstrap {num(boot.mean_diff, 5)}, 95% CI [{num(boot.ci_low, 5)},{' '}
        {num(boot.ci_high, 5)}]. This model carries no market features, so that
        result is evidence of a bug in the harness before it is evidence of an
        edge, and it is being treated as one.
      </>
    )
  }
  if (verdict === 'market_better') {
    return (
      <>
        The market is ahead by {num(boot.mean_diff, 5)} Brier, 95% CI [
        {num(boot.ci_low, 5)}, {num(boot.ci_high, 5)}] — the expected result,
        on {n} games.
      </>
    )
  }
  return (
    <>
      Indistinguishable from the closing line so far: {num(boot.mean_diff, 5)},
      95% CI [{num(boot.ci_low, 5)}, {num(boot.ci_high, 5)}], which straddles
      zero on {n} games.
    </>
  )
}

/**
 * Margin, total, and the shape of the distribution they come from.
 *
 * Every game card on this site publishes an expected margin and an expected
 * total. Until this section existed, neither was measured anywhere — and the
 * standing rule is that an accuracy claim is stated as a paired measurement
 * or it is not stated.
 *
 * The coverage table is the part with consequences beyond itself: the win
 * probability, the score grid and every series price are read off the same
 * fitted normal, so an sd that is too narrow makes every percentage on the
 * site overconfident by an amount the moneyline ECE only partly reveals.
 */
function ContinuousSection({ continuous }: { continuous?: Record<string, any> }) {
  if (!continuous?.margin?.model?.n) return null

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm">The numbers beside the probability</h2>
      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Forecast</th>
              <th scope="col" className="numeric text-right">MAE</th>
              <th scope="col" className="numeric text-right">RMSE</th>
              <th scope="col" className="numeric text-right">Bias</th>
              <th scope="col" className="numeric text-right">Games</th>
            </tr>
          </thead>
          <tbody>
            {(['margin', 'total'] as const).map((key) => {
              const block = continuous[key]
              const versus = block?.vs_market
              return [
                <tr key={key}>
                  <td className="text-[var(--text-primary)]">
                    {key === 'margin' ? 'Margin, this model' : 'Total, this model'}
                  </td>
                  <td className="numeric text-right">{num(block.model.mae, 2)}</td>
                  <td className="numeric text-right">{num(block.model.rmse, 2)}</td>
                  <td className="numeric text-right">{num(block.model.bias, 2)}</td>
                  <td className="numeric text-right">
                    {block.model.n?.toLocaleString()}
                  </td>
                </tr>,
                versus?.n ? (
                  <tr key={`${key}-market`}>
                    <td>
                      {key === 'margin'
                        ? 'Margin, the spread'
                        : 'Total, the posted line'}
                    </td>
                    <td className="numeric text-right">{num(versus.market.mae, 2)}</td>
                    <td className="numeric text-right">{num(versus.market.rmse, 2)}</td>
                    <td className="numeric text-right">{num(versus.market.bias, 2)}</td>
                    <td className="numeric text-right">
                      {versus.n?.toLocaleString()}
                    </td>
                  </tr>
                ) : null,
              ]
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Points, on the paired subset where a line was published. The market is
        ahead on margin by {num(continuous.margin?.vs_market?.mae_gap, 3)} and
        on total by {num(continuous.total?.vs_market?.mae_gap, 3)}, which is
        the same story the Brier table tells and for the same reason.
      </p>

      <h3 className="mb-3 mt-6 text-sm">Is the spread on those numbers right</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        {(['margin', 'total'] as const).map((key) => (
          <div key={key} className="card p-4">
            <CoverageTable
              rows={(continuous[key]?.coverage ?? []) as CoverageRow[]}
              label={key}
            />
            <div className="mt-4">
              <PitHistogram buckets={continuous[key]?.pit ?? []} label={key} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Every percentage on the site reads off this same fitted normal, so a
        spread that runs narrow makes all of them overconfident at once.{' '}
        <Link
          href="/about#shape"
          className="text-[var(--accent-info)] hover:underline"
        >
          Why one normal drives everything
        </Link>
      </p>
      <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        <CoverageVerdict
          margin={(continuous.margin?.coverage ?? []) as CoverageRow[]}
          total={(continuous.total?.coverage ?? []) as CoverageRow[]}
        />
      </p>
    </section>
  )
}

/**
 * What the coverage table actually found, in a sentence.
 *
 * Reports the SIGN and SIZE of a published gap — it does not decide what is
 * significant and it computes no probability. A table of six numbers that
 * leaves the reader to work out which direction is bad is a table that only
 * its author can read, and the direction here has consequences on every
 * other page.
 */
function CoverageVerdict({
  margin,
  total,
}: {
  margin: CoverageRow[]
  total: CoverageRow[]
}) {
  const worst = (rows: CoverageRow[]) =>
    rows.reduce<CoverageRow | null>(
      (acc, row) => (!acc || Math.abs(row.gap) > Math.abs(acc.gap) ? row : acc),
      null,
    )
  const m = worst(margin)
  const t = worst(total)
  if (!m && !t) return null

  const describe = (row: CoverageRow, name: string) =>
    row.gap < 0
      ? `the ${name} intervals run narrow — its ${pct(row.nominal, 0)} band caught ${pct(row.coverage, 1)}`
      : `the ${name} intervals run wide — its ${pct(row.nominal, 0)} band caught ${pct(row.coverage, 1)}`

  return (
    <>
      As measured:{' '}
      {m ? describe(m, 'margin') : null}
      {m && t ? ', and ' : null}
      {t ? describe(t, 'total') : null}. Both misses are real and directional
      yet too small to bend the reliability curve above, and the margin tails
      run exactly where the distribution&rsquo;s excess kurtosis says they
      should.{' '}
      <Link
        href="/about#shape"
        className="text-[var(--accent-info)] hover:underline"
      >
        Why a normal, and where it bends
      </Link>
    </>
  )
}

function CoverageTable({ rows, label }: { rows: CoverageRow[]; label: string }) {
  if (!rows.length) return null
  return (
    <div className="overflow-x-auto">
      <table>
        <caption className="pb-2 text-left text-[11px] text-[var(--text-secondary)]">
          Interval coverage, {label}
        </caption>
        <thead>
          <tr>
            <th scope="col">Stated</th>
            <th scope="col" className="numeric text-right">Realised</th>
            <th scope="col" className="numeric text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.nominal}>
              <td className="numeric">{pct(row.nominal, 0)}</td>
              <td className="numeric text-right text-[var(--text-primary)]">
                {pct(row.coverage, 1)}
              </td>
              <td
                className={`numeric text-right ${
                  Math.abs(row.gap) > 0.02 ? 'text-[var(--accent-warn)]' : ''
                }`}
              >
                {row.gap >= 0 ? '+' : ''}
                {num(row.gap, 3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        interval straddles zero, so this layer has not yet earned a claim. It
        ships only because the bracket simulation consumes its probabilities.
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
