import { fireEvent, render, screen, within } from '@testing-library/react'

import { TitleRaceChart } from '@/components/charts/TitleRaceChart'
import type { TitleRace } from '@/lib/history'

/* jsdom has neither PointerEvent nor layout: dispatch MouseEvents under the
   pointer-event names and pin the chart box to its viewBox size so CSS pixels
   equal viewBox units. (Local copies — a test file must not import another
   test file, or it re-registers that file's suites.) */
function mockChartBox(width: number, height: number) {
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function firePointer(
  element: Element | Window,
  type: 'pointermove' | 'pointerdown' | 'pointerleave',
  init: { clientX?: number; clientY?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(type === 'pointerleave' ? 'pointerout' : type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    relatedTarget: type === 'pointerleave' ? document.body : null,
  })
  Object.defineProperty(event, 'pointerType', {
    value: init.pointerType ?? 'mouse',
  })
  fireEvent(element, event)
}

const TEAMS = {
  BOS: { name: 'Boston Celtics', abbreviation: 'BOS', conference: 'Eastern Conference', logo: null },
  NY: { name: 'New York Knicks', abbreviation: 'NY', conference: 'Eastern Conference', logo: null },
  DET: { name: 'Detroit Pistons', abbreviation: 'DET', conference: 'Eastern Conference', logo: null },
  MIA: { name: 'Miami Heat', abbreviation: 'MIA', conference: 'Eastern Conference', logo: null },
  ORL: { name: 'Orlando Magic', abbreviation: 'ORL', conference: 'Eastern Conference', logo: null },
  OKC: { name: 'Oklahoma City Thunder', abbreviation: 'OKC', conference: 'Western Conference', logo: null },
}

const RACE: TitleRace = {
  season: 2026,
  basis: 'backtest',
  metric: 'p_conference_title',
  generated_at: '2026-08-15T00:00:00+00:00',
  tracked_per_conference: 6,
  champion: 'NY',
  teams: TEAMS,
  checkpoints: [
    {
      date: '2025-10-21',
      games_played: 0,
      probabilities: { BOS: 0.4, NY: 0.1, DET: 0.2, MIA: 0.2, ORL: 0.1, OKC: 1 },
    },
    {
      date: '2026-04-13',
      games_played: 1230,
      probabilities: { BOS: 0.3, NY: 0.35, DET: 0.25, MIA: 0.05, ORL: 0.05, OKC: 1 },
    },
  ],
  note: 'note',
}

describe('TitleRaceChart', () => {
  it('names three contenders and folds the rest into an explicit field', () => {
    // Three is what the palette validator allowed — every four-hue set
    // failed CVD separation. The tail is aggregated rather than dropped, and
    // because conference probabilities sum to one, named + field is all of
    // it.
    render(<TitleRaceChart race={RACE} conference="Eastern Conference" />)
    expect(screen.getByText('New York Knicks')).toBeInTheDocument()
    expect(screen.getByText('Boston Celtics')).toBeInTheDocument()
    expect(screen.getByText('Detroit Pistons')).toBeInTheDocument()
    expect(screen.getByText('field (2)')).toBeInTheDocument()
  })

  it('ranks the lines by where the race ENDED, not where it started', () => {
    // Boston leads at the first checkpoint and New York at the last. A chart
    // that ranked on the opening snapshot would drop the eventual champion.
    render(<TitleRaceChart race={RACE} conference="Eastern Conference" />)
    const table = screen.getByRole('table')
    const headers = Array.from(table.querySelectorAll('th')).map((th) => th.textContent)
    expect(headers).toEqual(['Date', 'Games', 'NY', 'BOS', 'DET', 'Field'])
  })

  it('sums the folded teams rather than showing the largest of them', () => {
    render(<TitleRaceChart race={RACE} conference="Eastern Conference" />)
    const rows = screen.getByRole('table').querySelectorAll('tbody tr')
    const opening = Array.from(rows[0].querySelectorAll('td')).map((td) => td.textContent)
    // date, games, NY, BOS, DET, field — and the field is MIA .20 + ORL .10,
    // not the larger of the two.
    expect(opening).toEqual(['2025-10-21', '0', '10.0%', '40.0%', '20.0%', '30.0%'])
  })

  it('labels a reconstruction as one', () => {
    render(<TitleRaceChart race={RACE} conference="Eastern Conference" />)
    expect(screen.getByText(/A reconstruction/i)).toBeInTheDocument()
    expect(screen.getByText(/nobody read these numbers/i)).toBeInTheDocument()
  })

  it('says a live line was published in advance', () => {
    render(
      <TitleRaceChart
        race={{ ...RACE, basis: 'live', champion: null }}
        conference="Eastern Conference"
      />,
    )
    expect(screen.getByText(/published in advance/i)).toBeInTheDocument()
    expect(screen.queryByText(/A reconstruction/i)).not.toBeInTheDocument()
  })

  it('explains a single point instead of drawing an empty chart', () => {
    // An empty plot area and a missing chart look identical to a reader, and
    // only one of them is the truth before the season starts.
    render(
      <TitleRaceChart
        race={{ ...RACE, basis: 'live', checkpoints: [RACE.checkpoints[0]] }}
        conference="Eastern Conference"
      />,
    )
    expect(screen.getByText(/One snapshot so far/i)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('never stacks two end-labels on the same row', () => {
    // Direct labels are the ONLY channel carrying identity for a colour-blind
    // reader — the validated trio's tritan separation is 4.6 — so two labels
    // on one pixel row means one team silently disappears. Here BOS and DET
    // finish a single point apart, which is roughly three units on the y
    // scale and would collide without the nudge.
    render(
      <TitleRaceChart
        race={{
          ...RACE,
          checkpoints: [
            RACE.checkpoints[0],
            {
              date: '2026-04-13',
              games_played: 1230,
              probabilities: { BOS: 0.33, NY: 0.32, DET: 0.31, MIA: 0.02, ORL: 0.02, OKC: 1 },
            },
          ],
        }}
        conference="Eastern Conference"
      />,
    )
    const svg = screen.getByRole('img')
    const ys = Array.from(svg.querySelectorAll('text'))
      .filter((node) => /^(BOS|NY|DET|field)\s/.test(node.textContent ?? ''))
      .map((node) => Number(node.getAttribute('y')))
      .sort((a, b) => a - b)
    expect(ys).toHaveLength(4)
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(11)
    }
  })

  it('only comments on the champion in the champion’s own conference', () => {
    // The Western panel noting that an Eastern team is missing from its three
    // lines reads as a finding. It is a tautology.
    render(<TitleRaceChart race={RACE} conference="Western Conference" />)
    expect(screen.queryByText(/won the title/i)).not.toBeInTheDocument()
  })

  it('carries every series in the accessible description, not only the colours', () => {
    render(<TitleRaceChart race={RACE} conference="Eastern Conference" />)
    const figure = screen.getByRole('img')
    expect(figure).toHaveAttribute(
      'aria-label',
      expect.stringContaining('NY: 10% at the start, 35% at the end.'),
    )
  })

  it('snaps the crosshair to the nearest checkpoint and lists every series there', () => {
    // 640-unit viewBox pinned at 640 CSS px; the two checkpoints land at
    // x = 46 and x = 552, so a move at 500 snaps to the second one.
    mockChartBox(640, 260)
    const { container } = render(
      <TitleRaceChart race={RACE} conference="Eastern Conference" />,
    )
    const svg = screen.getByRole('img')
    firePointer(svg, 'pointermove', { clientX: 500, clientY: 100 })

    expect(container.querySelector('[data-crosshair]')).toBeInTheDocument()
    // One highlight dot per visible series at the snapped x.
    expect(container.querySelectorAll('[data-highlight]')).toHaveLength(4)

    const tooltip = container.querySelector('[data-chart-tooltip]') as HTMLElement
    expect(tooltip).toHaveAttribute('data-active', 'true')
    // The checkpoint named, and the whole distribution — three named teams
    // plus the field — with every value as text.
    expect(within(tooltip).getByText(/2026-04-13/)).toBeInTheDocument()
    expect(within(tooltip).getByText(/1,230 games/)).toBeInTheDocument()
    expect(within(tooltip).getByText('NY')).toBeInTheDocument()
    expect(within(tooltip).getByText('35.0%')).toBeInTheDocument()
    expect(within(tooltip).getByText('BOS')).toBeInTheDocument()
    expect(within(tooltip).getByText('30.0%')).toBeInTheDocument()
    expect(within(tooltip).getByText('DET')).toBeInTheDocument()
    expect(within(tooltip).getByText('25.0%')).toBeInTheDocument()
    expect(within(tooltip).getByText('field (2)')).toBeInTheDocument()
    expect(within(tooltip).getByText('10.0%')).toBeInTheDocument()

    firePointer(svg, 'pointerleave')
    expect(tooltip).toHaveAttribute('data-active', 'false')
    jest.restoreAllMocks()
  })
})
