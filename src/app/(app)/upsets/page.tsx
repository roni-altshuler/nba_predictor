import Link from 'next/link'

import { getComebacks, getUpsets, type UpsetRow } from '@/lib/history'
import { gameDate, num, pct, stamp } from '@/lib/format'

export const metadata = { title: 'Upsets' }
export const dynamic = 'force-static'

/**
 * Twenty-three seasons ranked by how wrong somebody was.
 *
 * **Nothing here is new data.** Every archived game already carried a
 * retrodicted probability and, where a line existed, the market's — the
 * archive simply had no way to look across seasons, so the biggest upsets in
 * the corpus were computed and invisible. This page is a sort.
 *
 * Three boards, because "upset" is three questions:
 *
 * * the lowest probability the model gave a team that won — its worst days,
 *   published deliberately, because a record that shows only the good calls
 *   is an advertisement;
 * * the widest disagreements with the closing line, which are the only games
 *   where the two forecasters are distinguishable at all;
 * * the largest margin errors, because a 50-point game called at +2 is a
 *   different failure from a coin flip landing the other way, and one Brier
 *   hides the difference.
 *
 * Everything is a **backtest** and says so. The first three seasons are the
 * warm-up the model was fitted on and appear on no board rather than
 * appearing with a number that had seen the answer.
 */
export default function UpsetsPage() {
  const upsets = getUpsets()
  const comebacks = getComebacks()

  if (!upsets) {
    return (
      <div className="card p-6">
        <h1 className="text-sm">No upset boards published</h1>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          Run <code className="font-numeric">build_history</code> to generate
          them.
        </p>
      </div>
    )
  }

  const record = upsets.disagreement_record

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Archive</p>
        <h1 className="mt-1 text-2xl">The games nobody saw coming</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          {upsets.n_scored.toLocaleString()} games across{' '}
          {upsets.seasons.length} seasons, ranked three ways. Every
          probability here is a reconstruction — refitted monthly on games
          strictly earlier than the one it scores, so the model never saw the
          answer, and nobody read the number before the tip-off either.
        </p>
        <p className="mt-2 font-numeric text-[10px] uppercase tracking-[0.12em] text-[var(--accent-warn)]">
          Backtest
        </p>
      </header>

      <Board
        title="Biggest upsets"
        lead="The lowest probability the model gave a team that then won. Sorted by how badly it was wrong, most wrong first."
        rows={upsets.upsets}
        columns={[
          {
            head: 'Model gave the winner',
            render: (row) => (
              <span className="text-[var(--accent-warn)]">
                {pct(row.p_winner, 1)}
              </span>
            ),
          },
          {
            head: 'Market gave the winner',
            render: (row) =>
              row.p_market === null ? (
                <span className="text-[var(--text-tertiary)]">no line</span>
              ) : (
                pct(row.winner_home ? row.p_market : 1 - row.p_market, 1)
              ),
          },
        ]}
      />

      <section className="mb-10">
        <h2 className="mb-1 text-sm">Where it disagreed with the market</h2>
        <p className="mb-3 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
          The widest gaps between this model and the closing line, with the
          result attached. These are the only games where the two forecasters
          are distinguishable at all — everywhere else they say nearly the
          same thing and any difference in outcome is noise.
        </p>
        <div className="card mb-4 p-4">
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            Across all{' '}
            <span className="font-numeric">{record.n.toLocaleString()}</span>{' '}
            priced games the model was closer{' '}
            <span className="font-numeric">
              {pct(record.model_closer / Math.max(record.n, 1), 1)}
            </span>{' '}
            of the time. On the {record.top_n} widest disagreements below it
            was closer {record.model_closer_in_top} times.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            <strong className="text-[var(--text-secondary)]">
              Read the first number, not the second.
            </strong>{' '}
            A hundred games is a hundred games; the full-corpus figure is the
            one with any power, and it agrees with the Brier comparison on the
            record page. A board sorted by disagreement is selected on exactly
            the games where one side was furthest out on a limb, which is not
            a fair test of either.
          </p>
        </div>
        <BoardTable
          rows={upsets.disagreements}
          columns={[
            {
              head: 'Model',
              render: (row) => pct(row.p_winner, 1),
            },
            {
              head: 'Market',
              render: (row) => pct(row.p_winner_market, 1),
            },
            {
              head: 'Closer',
              render: (row) => (
                <span
                  className={
                    row.closer === 'model'
                      ? 'text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)]'
                  }
                >
                  {row.closer}
                </span>
              ),
            },
          ]}
        />
      </section>

      {comebacks?.comebacks.length ? (
        <section className="mb-10">
          <h2 className="mb-1 text-sm">Biggest comebacks</h2>
          <p className="mb-3 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
            The largest deficit at a quarter break that a team came back from,
            over all {comebacks.n_games_examined.toLocaleString()} games in the
            archive — the only board here that owes nothing to the model.
          </p>
          <div className="card mb-4 p-4">
            <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              <strong className="text-[var(--text-secondary)]">
                Every figure here is a lower bound.
              </strong>{' '}
              The archive holds the score at each quarter break, not at every
              moment, so a team shown as 30 down at half-time was almost
              certainly further behind at some point during it. The real
              number lives in play-by-play; this one is derived entirely from
              scores the archive actually has, and understates rather than
              guesses.
            </p>
          </div>
          <BoardTable
            rows={comebacks.comebacks}
            columns={[
              {
                head: 'Down by',
                render: (row) => (
                  <span className="text-[var(--accent-warn)]">
                    {(row as { deficit?: number }).deficit}
                  </span>
                ),
              },
              {
                head: 'At the end of',
                render: (row) => {
                  const period = (row as { after_period?: number }).after_period
                  return period ? `Q${period}` : '—'
                },
              },
              {
                head: 'OT',
                render: (row) => {
                  const ot = (row as { ot?: number }).ot
                  return ot ? (ot === 1 ? 'OT' : `${ot}OT`) : '—'
                },
              },
            ]}
          />
        </section>
      ) : null}

      <Board
        title="Biggest margin misses"
        lead="Where the expected margin was furthest from the real one. A blowout called as a coin flip is a different kind of error from a close game going the wrong way, and averaging them into one number hides it."
        rows={upsets.margin_misses}
        columns={[
          {
            head: 'Expected',
            render: (row) =>
              row.exp_margin === undefined
                ? '—'
                : `${row.exp_margin > 0 ? '+' : ''}${num(row.exp_margin, 1)}`,
          },
          {
            head: 'Actual',
            render: (row) =>
              row.actual_margin === undefined
                ? '—'
                : `${row.actual_margin > 0 ? '+' : ''}${row.actual_margin}`,
          },
          {
            head: 'Off by',
            render: (row) => (
              <span className="text-[var(--accent-warn)]">
                {num(row.error, 1)}
              </span>
            ),
          },
        ]}
      />

      <p className="mt-6 font-numeric text-[10px] text-[var(--text-tertiary)]">
        built {stamp(upsets.generated_at)} · seasons{' '}
        {upsets.seasons[0]}–{upsets.seasons[upsets.seasons.length - 1]}, the
        first {upsets.warmup_seasons} excluded as the model&rsquo;s warm-up
      </p>
    </div>
  )
}

interface Column {
  head: string
  render: (row: UpsetRow) => React.ReactNode
}

function Board({
  title,
  lead,
  rows,
  columns,
}: {
  title: string
  lead: string
  rows: UpsetRow[]
  columns: Column[]
}) {
  if (!rows.length) return null
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-sm">{title}</h2>
      <p className="mb-3 max-w-2xl text-xs leading-relaxed text-[var(--text-tertiary)]">
        {lead}
      </p>
      <BoardTable rows={rows} columns={columns} />
    </section>
  )
}

/**
 * One board.
 *
 * Every row links to the game, because the whole complaint this project
 * started from is a card that shows a fixture and does nothing when clicked.
 * A leaderboard of remarkable games that will not show you one of them is
 * the same failure in a different shape.
 */
function BoardTable({ rows, columns }: { rows: UpsetRow[]; columns: Column[] }) {
  return (
    <div className="card overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th scope="col" className="numeric">#</th>
            <th scope="col">Game</th>
            <th scope="col">Season</th>
            <th scope="col">Date</th>
            {columns.map((column) => (
              <th key={column.head} scope="col" className="numeric text-right">
                {column.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="numeric text-[var(--text-tertiary)]">{index + 1}</td>
              <td>
                <Link
                  href={`/games/${row.id}`}
                  className="text-[var(--text-primary)] underline decoration-[var(--border-color)] underline-offset-4 hover:decoration-[var(--text-secondary)]"
                >
                  <span className="font-numeric">{row.winner}</span>{' '}
                  <span className="text-[var(--text-tertiary)]">beat</span>{' '}
                  <span className="font-numeric">{row.loser}</span>{' '}
                  <span className="font-numeric text-[var(--text-secondary)]">
                    {Math.max(row.home_score, row.away_score)}&ndash;
                    {Math.min(row.home_score, row.away_score)}
                  </span>
                </Link>
                {row.phase && row.phase !== 'Final' ? (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                    {row.phase}
                  </span>
                ) : null}
              </td>
              {/* Without the season a board spanning 2004 to 2026 prints
                  "Sat, Jan 14" twenty-three times over and the reader cannot
                  tell which one they are looking at. */}
              <td className="numeric whitespace-nowrap text-[var(--text-tertiary)]">
                <Link
                  href={`/seasons/${row.season}`}
                  className="hover:text-[var(--text-secondary)]"
                >
                  {row.season - 1}&ndash;{String(row.season).slice(2)}
                </Link>
              </td>
              <td className="numeric whitespace-nowrap text-[var(--text-tertiary)]">
                {gameDate(row.date)}
              </td>
              {columns.map((column) => (
                <td key={column.head} className="numeric text-right">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
