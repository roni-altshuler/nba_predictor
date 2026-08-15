import { getEloSweep, getMarketBenchmark } from '@/lib/artifacts'
import { num, pct } from '@/lib/format'

export const metadata = { title: 'How it works' }
export const dynamic = 'force-static'

export default function AboutPage() {
  const benchmark = getMarketBenchmark() as Record<string, any> | null
  const sweep = getEloSweep() as Record<string, any> | null
  const paired = benchmark?.paired_vs_market ?? {}
  const eras: Record<string, any> = sweep?.home_advantage_by_era ?? {}

  return (
    <div className="max-w-2xl">
      <header className="mb-8">
        <p className="eyebrow">Method</p>
        <h1 className="mt-1 text-2xl">How it works</h1>
      </header>

      <Section title="What it does">
        <p>
          Four things, and nothing else: a win probability for every game, a
          projected season and playoff picture, a value surface comparing the
          model against the no-vig market price, and a playoff-series layer.
          If a proposed feature is none of those, it does not belong here.
        </p>
      </Section>

      <Section title="The market is the benchmark">
        <p>
          Any accuracy claim is stated as a paired score against the closing
          line on named games, or it is not stated. On{' '}
          {paired.n?.toLocaleString() ?? '—'} priced games the closing line
          scores {num(paired.market?.brier, 4)} Brier and this model scores{' '}
          {num(paired.model?.brier, 4)} — a gap of{' '}
          +{num(paired.model_gap_to_market, 4)}.
        </p>
        <p>
          The model is behind, and that is the honest and expected result. It
          carries no market features at all. A model with none that beat the
          closing line would be announcing a bug in the harness rather than an
          edge, and this project treats that outcome as a reason to audit
          rather than to celebrate.
        </p>
      </Section>

      <Section title="Why margin and total, not a score model">
        <p>
          Soccer forecasting models two goal counts as Poisson draws, because
          soccer scores are small integers where that shape is right. NBA
          scores average around 110 with a variance far below their mean —
          nothing like Poisson — and the quantities that matter are the
          difference and the sum. So this model is parameterised on margin and
          total, which are close to jointly normal, and the two team scores
          are recovered from them.
        </p>
        <p>
          Measured on 27,690 regular-season games, margin has mean +2.6 and
          standard deviation 13.8, with skewness −0.02 and excess kurtosis
          +0.30. Normal is a genuinely good fit here, not a convenience. And
          there is no draw to allocate: overtime resolves every game, so{' '}
          <strong>zero</strong> of those 27,690 finished level.
        </p>
      </Section>

      <Section title="Home advantage has collapsed">
        <p>
          This is the sport&apos;s most under-appreciated recent change, and a
          fixed constant would mis-price the modern game badly. Measured on
          this corpus:
        </p>
        <div className="card my-3 overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th scope="col">Era</th>
                <th scope="col" className="numeric text-right">Home win rate</th>
                <th scope="col" className="numeric text-right">Mean margin</th>
                <th scope="col" className="numeric text-right">Rating points</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(eras).map(([era, stats]: [string, any]) => (
                <tr key={era}>
                  <td className="numeric">{era}</td>
                  <td className="numeric text-right">
                    {pct(stats.home_win_rate, 2)}
                  </td>
                  <td className="numeric text-right">
                    +{num(stats.mean_margin, 2)}
                  </td>
                  <td className="numeric text-right text-[var(--text-primary)]">
                    {num(stats.elo_points, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          The served model refits monthly and picks the current value up
          through its intercept, so it tracks this drift rather than assuming
          it away.
        </p>
      </Section>

      <Section title="Ratings regress between seasons">
        <p>
          Elo carries forward at 60%, with the remaining 40% pulled to the
          league mean. That was measured across six levels, and carrying
          ratings forward untouched was the worst of them.
        </p>
        <p>
          It is also the opposite of what the sibling soccer project found,
          where season-boundary regression was tested and rejected at every
          level. The difference is institutional rather than statistical: the
          NBA drafts in reverse order of finish and caps payrolls, European
          football does neither. Conclusions do not port across sports.
        </p>
      </Section>

      <Section title="Season simulation">
        <p>
          Each simulated season draws one strength offset per team and holds
          it for all 82 games. Within-season rating drift measured 36.1 points
          over 689 team-seasons, and that error is correlated across a
          team&apos;s whole schedule — a team that is better than its rating is
          better in all 82 — so no number of simulations averages it away.
        </p>
        <p>
          The play-in is modelled exactly: 7v8, 9v10, and the 7/8 loser
          hosting the elimination game. It is the difference between a 45% and
          a 70% playoff probability for precisely the teams a reader cares
          most about, and approximating it as &ldquo;top eight qualify&rdquo;
          would throw that away.
        </p>
      </Section>

      <Section title="Playoff series">
        <p>
          A best-of-seven is not one game with a bigger sample. Home court
          alternates on a 2-2-1-1-1 pattern, and the series probability is
          computed by enumerating every path rather than simulating — a
          best-of-seven has at most 128 of them, so the exact answer is
          cheaper than an estimate of it and carries no sampling noise.
        </p>
        <p>
          The Finals ran 2-3-2 through 2013 and 2-2-1-1-1 since, and the
          backtest uses the pattern each series actually played under.
        </p>
      </Section>

      <Section title="What it will not do">
        <p>
          It will not show a value flag on an edge smaller than its own
          measured calibration error — below that, &ldquo;value&rdquo; is
          indistinguishable from the model being slightly off. It will not
          merge its historical walk-forward with a live published record. It
          will not impute a missing sportsbook line, a missing box score, or a
          missing result: sparse coverage stays genuinely missing.
        </p>
        <p className="text-[var(--text-tertiary)]">
          Nothing here is betting advice.
        </p>
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  )
}
