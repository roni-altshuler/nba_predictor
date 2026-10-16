import { render, screen, within } from '@testing-library/react'

import { InjuryReport } from '@/components/schedule/InjuryReport'
import { type InjuryEntry, type InjuryReportData, type TeamInjuries } from '@/lib/espn'

const away = { name: 'Boston Celtics', abbreviation: 'BOS' }
const home = { name: 'Detroit Pistons', abbreviation: 'DET' }
const entry: InjuryEntry = { player: 'Example player', position: 'C', status: 'Out', detail: 'Left knee surgery', returnDate: null, date: '2026-10-14T18:45:00Z' }
function team(displayName: string, entries: InjuryEntry[] = [], coverage: TeamInjuries['coverage'] = 'complete'): TeamInjuries {
  return { teamId: displayName, displayName, entries, coverage }
}
function show(injuries: InjuryReportData) {
  return render(<InjuryReport injuries={injuries} away={away} home={home} />)
}
function side(abbreviation: string) {
  return within(screen.getByRole('heading', { name: abbreviation }).parentElement!)
}

it.each(['http', 'request', 'payload'] as const)('reports provider %s failure without claiming empty coverage', (reason) => {
  show({ status: 'unavailable', reason })
  expect(screen.getByRole('region', { name: 'Availability' })).toHaveTextContent('ESPN availability could not be loaded')
  expect(screen.queryByText(/No players listed/)).not.toBeInTheDocument()
  expect(screen.getByText('The forecast above has not read this')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'why' })).toHaveAttribute('href', '/about#missing')
})

it('shows both explicitly empty team reports with no invented freshness', () => {
  show({ status: 'available', teams: [team(home.name), team(away.name)] })
  expect(screen.getAllByText("No players listed in ESPN's report.")).toHaveLength(2)
  expect(screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual(['BOS', 'DET'])
  expect(document.querySelector('time')).toBeNull()
  expect(screen.getByText('The forecast above has not read this')).toBeInTheDocument()
})

it('keeps the other team’s empty column when one team has entries', () => {
  show({ status: 'available', teams: [team(away.name, [entry]), team(home.name)] })
  expect(side('BOS').getByText('Example player')).toBeInTheDocument()
  expect(side('DET').getByText("No players listed in ESPN's report.")).toBeInTheDocument()
  expect(side('BOS').getByText('Out')).toBeInTheDocument()
})

it('distinguishes an unmatched team from a reported empty team', () => {
  show({ status: 'available', teams: [team(away.name)] })
  expect(side('BOS').getByText("No players listed in ESPN's report.")).toBeInTheDocument()
  expect(side('DET').getByText('No ESPN report found for this team.')).toBeInTheDocument()
  expect(side('DET').queryByText(/No players listed/)).not.toBeInTheDocument()
})

it('does not infer team coverage from an empty league response', () => {
  show({ status: 'available', teams: [] })
  expect(screen.getAllByText('No ESPN report found for this team.')).toHaveLength(2)
  expect(screen.queryByText(/No players listed/)).not.toBeInTheDocument()
})

it.each([{ entries: [] }, { entries: [entry] }])('labels incomplete nested reports while retaining usable entries: %p', ({ entries }) => {
  show({ status: 'available', teams: [team(away.name, entries, 'partial'), team(home.name)] })
  expect(side('BOS').getByText(/report is incomplete/)).toBeInTheDocument()
  expect(side('BOS').queryByText(/No players listed/)).not.toBeInTheDocument()
  expect(side('DET').getByText("No players listed in ESPN's report.")).toBeInTheDocument()
  expect(screen.queryByText('Example player')).toBe(entries.length ? side('BOS').getByText('Example player') : null)
})

it('shows the provider entry timestamp in UTC, never the render time', () => {
  jest.useFakeTimers().setSystemTime(new Date('2099-01-01T00:00:00Z'))
  try {
    show({ status: 'available', teams: [team(away.name, [entry])] })
    const time = document.querySelector('time')!
    expect(time).toHaveAttribute('dateTime', entry.date)
    expect(time).toHaveTextContent('Oct 14, 2026')
    expect(time).toHaveTextContent('6:45 PM UTC')
    expect(screen.getByText(/Entry dated/)).toBeInTheDocument()
    expect(screen.queryByText(/2099|Updated|as of/i)).not.toBeInTheDocument()
  } finally { jest.useRealTimers() }
})

it('preserves a date-only entry without inventing a time of day', () => {
  show({ status: 'available', teams: [team(away.name, [{ ...entry, date: '2026-10-14' }])] })
  const time = document.querySelector('time')!
  expect(time).toHaveAttribute('dateTime', '2026-10-14')
  expect(time).toHaveTextContent('Oct 14, 2026')
  expect(time.textContent).not.toMatch(/UTC|AM|PM/)
})

it.each([null, 'invalid', '2026-02-30', '2026-10-14T18:45'])('renders absent or invalid dates as unavailable: %p', (date) => {
  show({ status: 'available', teams: [team(away.name, [{ ...entry, date }])] })
  expect(screen.getByText('Entry date unavailable')).toBeInTheDocument()
  expect(document.querySelector('time')).toBeNull()
})
