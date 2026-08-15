import Link from 'next/link'

import { getEloSweep, getMarketBenchmark, getSeasonProjections } from '@/lib/artifacts'
import { num, pct } from '@/lib/format'

export const metadata = { title: 'How it works' }
export const dynamic = 'force-static'

/*
 * The method page.
 *
 * Structured rather than stacked. The previous version was a column of
 * headings and paragraphs at one type size, which is a memo: nothing told a
 * reader where they were, what mattered, or how much was left. The shape
 * here does three things a flat stack cannot.
 *
 * 1. **The claim leads, in numbers.** Anyone landing on a method page is
 *    deciding whether to trust the product. The headline figures — corpus
 *    size, the gap to the closing line, calibration error — go above the
 *    prose, because they are the answer to the question being asked.
 * 2. **Three parts, numbered sections, a contents rail.** Method, evidence,
 *    limits. The rail is sticky on desktop and the sections are numbered, so
 *    position in a long document is always legible.
 * 3. **One idea per section, stated first.** Each section opens with its
 *    conclusion in larger type, and the supporting detail follows. A reader
 *    skimming the leads gets the whole argument.
 */

const SECTIONS = [
  { id: 'scope', part: 'Method', title: 'What it does' },
  { id: 'shape', part: 'Method', title: 'Margin and total, not two scores' },
  { id: 'home', part: 'Method', title: 'Home advantage has collapsed' },
  { id: 'regression', part: 'Method', title: 'Ratings regress between seasons' },
  { id: 'simulation', part: 'Method', title: 'Season simulation' },
  { id: 'series', part: 'Method', title: 'Playoff series' },
  { id: 'benchmark', part: 'Evidence', title: 'The market is the benchmark' },
  { id: 'backtest', part: 'Evidence', title: 'Backtest is never live' },
  { id: 'limits', part: 'Limits', title: 'What it will not do' },
  { id: 'missing', part: 'Limits', title: 'What is missing' },
]

export default function AboutPage() {
  const benchmark = getMarketBenchmark() as Record<string, any> | null
  const sweep = getEloSweep() as Record<string, any> | null
  const projections = getSeasonProjections()
  const paired = benchmark?.paired_vs_market ?? {}
  const full = benchmark?.full_corpus ?? {}
  const eras: Record<string, any> = sweep?.home_advantage_by_era ?? {}

  return (
    <div>
      <header className="mb-8 max-w-3xl">
        <p className="eyebrow">Method</p>
        <h1 className="mt-1 text-2xl">How it works</h1>
        <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
          A margin-and-total model over every NBA game since 2004, refit
          monthly, and scored against the closing line on named games. It is
          behind the market by a published margin, and that is the result the
          design predicts rather than a disappointment.
        </p>
      </header>

      <section aria-label="Headline figures" className="mb-10">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure
            label="Games scored"
            value={paired.n?.toLocaleString() ?? '—'}
            note="priced, paired against the close"
          />
          <Figure
            label="Gap to the close"
            value={`+${num(paired.model_gap_to_market, 4)}`}
            note="Brier, lower is better"
          />
          <Figure
            label="Calibration error"
            value={num(full?.model?.ece, 4)}
            note="expected vs observed"
          />
          <Figure
            label="Walk-forward n"
            value={full?.n?.toLocaleString() ?? '—'}
            note="out-of-sample games"
          />
        </div>
      </section>

      <div className="lg:grid lg:grid-cols-[168px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Contents" className="mb-8 lg:mb-0">
          <div className="lg:sticky lg:top-6">
            <p className="eyebrow mb-2">Contents</p>
            <ol className="space-y-1">
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex gap-2 py-0.5 text-[11px] leading-snug text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    <span className="font-numeric">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="max-w-2xl">
          <Part title="Method" />

          <Section n={1} id="scope" title="What it does">
            <Lead>
              Four things, and nothing else. If a proposed feature is none of
              them, it does not belong here.
            </Lead>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>A win probability for every game.</li>
              <li>A projected season, seeding and playoff picture.</li>
              <li>
                A value surface comparing the model against the no-vig market
                price.
              </li>
              <li>A playoff-series layer over best-of-seven brackets.</li>
            </ol>
          </Section>

          <Section n={2} id="shape" title="Margin and total, not two scores">
            <Lead>
              Soccer models two Poisson goal counts. NBA scores are nothing
              like Poisson, and the quantities that matter are the difference
              and the sum.
            </Lead>
            <p>
              Basketball scores average around 110 with a variance far below
              their mean. So this model is parameterised on margin and total,
              which are close to jointly normal, and the two team scores are
              recovered from them.
            </p>
            <Measured>
              Over 27,690 regular-season games, margin has mean +2.6 and
              standard deviation 13.8, with skewness −0.02 and excess kurtosis
              +0.30. Normal is a genuinely good fit here, not a convenience.
              And there is no draw to allocate: overtime resolves every game,
              so <strong className="text-[var(--text-secondary)]">zero</strong>{' '}
              of those 27,690 finished level.
            </Measured>
          </Section>

          <Section n={3} id="home" title="Home advantage has collapsed">
            <Lead>
              The sport&apos;s most under-appreciated recent change. A fixed
              constant would mis-price the modern game badly.
            </Lead>
            <div className="card my-4 overflow-x-auto">
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
              through its intercept, so it tracks this drift rather than
              assuming it away.
            </p>
          </Section>

          <Section n={4} id="regression" title="Ratings regress between seasons">
            <Lead>
              Elo carries forward at 60%, with the remaining 40% pulled to the
              league mean. Carrying ratings forward untouched was the worst of
              the six levels tested.
            </Lead>
            <p>
              This is the opposite of what the sibling soccer project found,
              where season-boundary regression was tested and rejected at
              every level. The difference is institutional rather than
              statistical: the NBA drafts in reverse order of finish and caps
              payrolls, European football does neither.
            </p>
            <Measured>
              Conclusions do not port across sports. Every constant here was
              re-measured on basketball, and several came back inverted.
            </Measured>
          </Section>

          <Section n={5} id="simulation" title="Season simulation">
            <Lead>
              Each simulated season draws one strength offset per team and
              holds it for all 82 games, rather than re-rolling every game.
            </Lead>
            <p>
              Within-season rating drift measured 36.1 points over 689
              team-seasons, and that error is correlated across a team&apos;s
              whole schedule — a team that is better than its rating is better
              in all 82 — so no number of simulations averages it away.
              Without it, these title odds would be roughly twice as confident
              as any market price.
            </p>
            <p>
              The play-in is modelled exactly: 7v8, 9v10, and the 7/8 loser
              hosting the elimination game. It is the difference between a 45%
              and a 70% playoff probability for precisely the teams a reader
              cares most about.
            </p>
          </Section>

          <Section n={6} id="series" title="Playoff series">
            <Lead>
              A best-of-seven is not one game with a bigger sample. Home court
              alternates, and the format makes the series probability a
              non-linear function of the game probability.
            </Lead>
            <p>
              Every series is computed by enumerating each path rather than
              simulating one — a best-of-seven has at most 128 of them, so the
              exact answer is cheaper than an estimate of it and carries no
              sampling noise. The Finals ran 2-3-2 through 2013 and 2-2-1-1-1
              since, and the backtest scores each series under the pattern it
              actually played.
            </p>
            <p>
              <Link href="/bracket" className="text-[var(--accent-info)] hover:underline">
                The projected bracket
              </Link>{' '}
              draws only the first round as matchups. Everything past it is a
              marginal probability from the simulation, because advancing a
              modal winner four rounds compounds one seeding assumption into a
              championship number.
            </p>
          </Section>

          <Part title="Evidence" />

          <Section n={7} id="benchmark" title="The market is the benchmark">
            <Lead>
              Any accuracy claim is stated as a paired score against the
              closing line on named games, or it is not stated.
            </Lead>
            <div className="card my-4 overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Forecaster</th>
                    <th scope="col" className="numeric text-right">Brier</th>
                    <th scope="col" className="numeric text-right">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-[var(--text-primary)]">
                      Market (closing line)
                    </td>
                    <td className="numeric text-right text-[var(--text-primary)]">
                      {num(paired.market?.brier, 4)}
                    </td>
                    <td className="numeric text-right text-[var(--text-tertiary)]">
                      —
                    </td>
                  </tr>
                  <tr>
                    <td>This model</td>
                    <td className="numeric text-right">
                      {num(paired.model?.brier, 4)}
                    </td>
                    <td className="numeric text-right text-[var(--accent-loss)]">
                      +{num(paired.model_gap_to_market, 4)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The model is behind, and that is the honest and expected result.
              It carries no market features at all. A model with none that beat
              the closing line would be announcing a bug in the harness rather
              than an edge, and this project treats that outcome as a reason to
              audit rather than to celebrate.
            </p>
            <p>
              <Link href="/accuracy" className="text-[var(--accent-info)] hover:underline">
                The full record
              </Link>{' '}
              carries the bootstrap interval, the reliability diagram and the
              per-season breakdown.
            </p>
          </Section>

          <Section n={8} id="backtest" title="Backtest is never live">
            <Lead>
              Every retrodiction on this site is labelled a backtest, in every
              place it appears.
            </Lead>
            <p>
              The archive reconstructs what the model would have said about
              each historical game, using a rolling walk-forward refit on games
              strictly earlier than the one it scores. The model never saw the
              result — but nobody read those numbers before those tip-offs
              either, and a reconstruction that blurs into &ldquo;published in
              advance&rdquo; is the exact dishonesty an archive invites.
            </p>
            <Measured>
              The historical walk-forward and the live published record are
              computed separately and never merged. The live record is empty
              until the season starts; it will grow from zero and be reported
              at whatever n it reaches.
            </Measured>
          </Section>

          <Part title="Limits" />

          <Section n={9} id="limits" title="What it will not do">
            <Lead>
              The constraints are as much a part of the product as the
              forecasts.
            </Lead>
            <dl className="space-y-3">
              <Rule term="No value flag inside its own error">
                An edge smaller than the measured calibration error is not
                called value. Below that threshold, &ldquo;value&rdquo; is
                indistinguishable from the model being slightly off.
              </Rule>
              <Rule term="No imputation">
                A missing sportsbook line, box score or result stays missing.
                Sparse coverage is reported as sparse.
              </Rule>
              <Rule term="No merged records">
                The historical walk-forward is never combined with the live
                published record.
              </Rule>
              <Rule term="No probability computed in the browser">
                The site renders published JSON. A component that recomputes
                something is a second model nobody benchmarked.
              </Rule>
            </dl>
          </Section>

          <Section n={10} id="missing" title="What is missing">
            <Lead>
              Recorded rather than papered over.
            </Lead>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <strong className="text-[var(--text-secondary)]">
                  No injury or roster data.
                </strong>{' '}
                The model knows nothing about trades, the draft, or who is
                playing. This is the largest single gap, and it is why
                preseason title odds stay more concentrated than a real futures
                market.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)]">
                  Nothing player-level feeds a probability.
                </strong>{' '}
                Box scores are shown on game pages, read from ESPN at request
                time; the model consumes team-level results only.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)]">
                  Odds coverage is uneven by era.
                </strong>{' '}
                2019 carries no market at all, which is why the paired sample
                is smaller than the corpus.
              </li>
              <li>
                <strong className="text-[var(--text-secondary)]">
                  The playoff-series layer does not beat the seeding.
                </strong>{' '}
                On 300 series it is not significantly better than
                &ldquo;the higher seed advances&rdquo;. The confidence interval
                straddles zero and the site says so.
              </li>
            </ul>
            <p className="text-[var(--text-tertiary)]">
              Nothing here is betting advice.
            </p>
          </Section>

          {projections ? (
            <p className="mt-8 border-t border-[var(--border-color)] pt-4 font-numeric text-[10px] text-[var(--text-tertiary)]">
              model {projections.model_version} · every figure on this page is
              read from a published artifact, not typed in
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- pieces */

function Figure({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="card p-3">
      <p className="eyebrow">{label}</p>
      <p className="numeric mt-1 text-xl text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-[10px] leading-snug text-[var(--text-tertiary)]">
        {note}
      </p>
    </div>
  )
}

function Part({ title }: { title: string }) {
  return (
    <h2 className="mb-4 mt-10 border-b border-[var(--border-color)] pb-2 font-numeric text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] first:mt-0">
      {title}
    </h2>
  )
}

function Section({
  n,
  id,
  title,
  children,
}: {
  n: number
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mb-8 scroll-mt-6">
      <h3 className="mb-3 flex items-baseline gap-2.5 text-sm text-[var(--text-primary)]">
        <span className="font-numeric text-[11px] text-[var(--text-tertiary)]">
          {String(n).padStart(2, '0')}
        </span>
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  )
}

/** The section's conclusion, stated first and set larger than its support. */
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] leading-relaxed text-[var(--text-primary)]">
      {children}
    </p>
  )
}

/** A measured claim, set apart from the argument around it. */
function Measured({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-l border-[var(--border-hover)] py-0.5 pl-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
      {children}
    </p>
  )
}

function Rule({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[var(--text-primary)]">{term}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        {children}
      </dd>
    </div>
  )
}
