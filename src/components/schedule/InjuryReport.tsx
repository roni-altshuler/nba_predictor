import Link from 'next/link'

import { injuryDate, type InjuryReportData } from '@/lib/espn'
import { cn } from '@/lib/utils'

type Side = { name: string; abbreviation: string }

/** Descriptive provider coverage beside a forecast that has not read it. */
export function InjuryReport({ injuries, away, home }: {
  injuries: InjuryReportData
  away: Side
  home: Side
}) {
  return (
    <section className="card mb-6 p-4" aria-labelledby="availability-heading">
      <h2 id="availability-heading" className="mb-3 text-sm">Availability</h2>
      {injuries.status === 'unavailable' ? (
        <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          ESPN availability could not be loaded. Reports for both teams are unavailable.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[away, home].map((side) => {
            const team = injuries.teams.find((row) =>
              row.displayName.trim().toLowerCase() === side.name.trim().toLowerCase(),
            )
            return (
              <div key={side.abbreviation}>
                <h3 className="font-numeric text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  <abbr title={side.name} className="no-underline">{side.abbreviation}</abbr>
                </h3>
                {!team ? (
                  <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">No ESPN report found for this team.</p>
                ) : (
                  <>
                    {team.coverage === 'partial' ? (
                      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">ESPN&apos;s report is incomplete.</p>
                    ) : team.entries.length === 0 ? (
                      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">No players listed in ESPN&apos;s report.</p>
                    ) : null}
                    {team.entries.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {team.entries.map((entry, index) => (
                          <li key={`${entry.player}-${entry.status}-${index}`} className="text-[11px]">
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="min-w-0 break-words text-[var(--text-primary)]">
                                {entry.player}
                                {entry.position ? <span className="ml-1.5 text-[var(--text-tertiary)]">{entry.position}</span> : null}
                                {entry.detail ? <span className="ml-1.5 text-[var(--text-tertiary)]">{entry.detail}</span> : null}
                              </span>
                              <span className={cn(
                                'max-w-[45%] shrink-0 break-words text-right font-numeric text-[10px] uppercase tracking-[0.08em]',
                                entry.status.toLowerCase() === 'out' ? 'text-[var(--accent-warn)]' : 'text-[var(--text-tertiary)]',
                              )}>{entry.status}</span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]"><EntryDate value={entry.date} /></p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        <strong className="text-[var(--text-secondary)]">The forecast above has not read this</strong>{' '}
        — the model has never seen a roster, and ESPN keeps no injury archive
        to test one against (<Link href="/about#missing" className="text-[var(--accent-info)] underline hover:underline">why</Link>).
      </p>
    </section>
  )
}

function EntryDate({ value }: { value: string | null }) {
  const date = injuryDate(value)
  if (!date) return <>Entry date unavailable</>
  const withTime = date.includes('T')
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } as const : {}),
  }).format(new Date(date))
  return <>Entry dated <time dateTime={date}>{label}</time></>
}
