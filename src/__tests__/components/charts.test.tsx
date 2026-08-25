import { fireEvent, render, screen, within } from '@testing-library/react'

import { PitHistogram } from '@/components/charts/PitHistogram'
import { WinProbabilityChart } from '@/components/charts/WinProbabilityChart'
import type { PitBucket } from '@/lib/artifacts'
import type { WinProbability } from '@/lib/espn'

/**
 * jsdom implements neither PointerEvent nor layout, so the hover-layer tests
 * dispatch MouseEvents under the pointer-event names (React listens by name
 * and reads the same coordinate fields) and pin the chart box to its viewBox
 * size so CSS pixels equal viewBox units.
 */
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
  // React synthesises onPointerLeave from a bubbling `pointerout` whose
  // relatedTarget sits outside the element — a literal `pointerleave` event
  // never reaches its plugin.
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

function curve(values: number[], periods?: number[]): WinProbability {
  const points = values.map((homeWinPercentage, i) => ({
    sequence: i,
    homeWinPercentage,
    homeScore: null,
    awayScore: null,
    period: periods?.[i] ?? null,
    clock: null,
  }))
  return {
    gameId: 'g',
    points,
    biggestSwing: {
      delta: 0.34,
      toward: 'away',
      from: 0.6,
      to: 0.26,
      period: 4,
      clock: '2:11',
    },
    comebackFrom: 0.08,
  }
}

describe('WinProbabilityChart', () => {
  it('says in words that the number is ESPN’s and not ours', () => {
    // Two forecasters on one page and only one of them benchmarked here.
    // The distinction has to survive a reader skimming.
    render(
      <WinProbabilityChart
        probability={curve([0.5, 0.3, 0.8])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(screen.getByText(/from ESPN/i)).toBeInTheDocument()
    expect(
      screen.getByText(/stops at tip-off/i),
    ).toBeInTheDocument()
  })

  it('names both sides in the accessible label and says who won', () => {
    render(
      <WinProbabilityChart
        probability={curve([0.5, 0.3, 0.8])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(
      screen.getByRole('img', { name: /BOS against LAL\. BOS won\./i }),
    ).toBeInTheDocument()
  })

  it('attributes the win to the away side when the curve ends below even', () => {
    render(
      <WinProbabilityChart
        probability={curve([0.5, 0.7, 0.1])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(screen.getByRole('img', { name: /LAL won\./i })).toBeInTheDocument()
  })

  it('names what is missing for a curve too short to be a curve', () => {
    // The unified empty state: a missing artifact must be distinguishable
    // from a layout bug, so no chart ever returns silent null.
    const { container } = render(
      <WinProbabilityChart
        probability={curve([0.5])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(
      screen.getByText(/No in-game win probability published/i),
    ).toBeInTheDocument()
    expect(container.querySelector('[data-chart-empty]')).toHaveClass('eyebrow')
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('labels period boundaries rather than an opaque play index', () => {
    render(
      <WinProbabilityChart
        probability={curve([0.5, 0.4, 0.6, 0.7], [1, 2, 3, 4])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(screen.getByText('Q2')).toBeInTheDocument()
    expect(screen.getByText('Q4')).toBeInTheDocument()
  })

  it('names overtime as OT rather than as Q5', () => {
    render(
      <WinProbabilityChart
        probability={curve([0.5, 0.4, 0.6], [4, 5, 5])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(screen.getByText('OT1')).toBeInTheDocument()
  })

  it('reports the comeback from the winner’s own low point', () => {
    render(
      <WinProbabilityChart
        probability={curve([0.5, 0.3, 0.8])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(screen.getByText('8.0%')).toBeInTheDocument()
  })
})

function flat(): PitBucket[] {
  return Array.from({ length: 10 }, (_, i) => ({
    lower: i / 10,
    upper: (i + 1) / 10,
    count: 100,
    share: 0.1,
    expected: 0.1,
  }))
}

describe('PitHistogram', () => {
  it('draws one bar per bucket', () => {
    const { container } = render(<PitHistogram buckets={flat()} label="margin" />)
    expect(container.querySelectorAll('rect')).toHaveLength(10)
  })

  it('draws the uniform reference the bars are judged against', () => {
    render(<PitHistogram buckets={flat()} label="margin" />)
    expect(screen.getByText('uniform')).toBeInTheDocument()
  })

  it('says what a failure would look like, not only what the chart is', () => {
    render(<PitHistogram buckets={flat()} label="margin" />)
    expect(screen.getByText(/too narrow/i)).toBeInTheDocument()
    expect(screen.getByText(/overconfident/i)).toBeInTheDocument()
  })

  it('reports absence rather than drawing an empty axis', () => {
    render(<PitHistogram buckets={[]} label="total" />)
    expect(screen.getByText(/No PIT histogram published/i)).toBeInTheDocument()
  })

  it('does not magnify a near-perfect histogram into a dramatic one', () => {
    // Scale is floored at twice the expectation, so ten equal bars fill half
    // the plot rather than all of it. Without the floor, any flat histogram
    // renders identically to a badly skewed one.
    const { container } = render(<PitHistogram buckets={flat()} label="margin" />)
    const heights = Array.from(container.querySelectorAll('rect')).map((r) =>
      Number(r.getAttribute('height')),
    )
    const plotHeight = 190 - 14 - 30
    expect(heights.every((h) => Math.abs(h - plotHeight / 2) < 0.001)).toBe(true)
  })

  it('scales to the tallest bar when one genuinely dominates', () => {
    const skewed = flat()
    skewed[0] = { ...skewed[0], share: 0.5, count: 500 }
    const { container } = render(<PitHistogram buckets={skewed} label="total" />)
    const heights = Array.from(container.querySelectorAll('rect')).map((r) =>
      Number(r.getAttribute('height')),
    )
    expect(Math.max(...heights)).toBeCloseTo(190 - 14 - 30, 5)
  })
})

describe('the shared hover layer', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows a styled tooltip for the hovered PIT bar and clears on mouse leave', () => {
    // PitHistogram: 460-unit viewBox, plot from x=40 to x=446, ten bars of
    // 40.6 units. With the box pinned at 460 CSS px, clientX is viewBox x.
    mockChartBox(460, 190)
    const skewed = flat()
    skewed[0] = { ...skewed[0], share: 0.5, count: 500 }
    const { container } = render(<PitHistogram buckets={skewed} label="total" />)
    const svg = screen.getByRole('img')

    firePointer(svg, 'pointermove', { clientX: 60, clientY: 100 })

    const tooltip = container.querySelector('[data-chart-tooltip]') as HTMLElement
    expect(tooltip).toHaveAttribute('data-active', 'true')
    // The whole claim, as text: the bin, the observed share, the uniform
    // reference, and the sample size.
    expect(within(tooltip).getByText(/decile 0\.0–0\.1/)).toBeInTheDocument()
    expect(within(tooltip).getByText('observed')).toBeInTheDocument()
    expect(within(tooltip).getByText('50.0%')).toBeInTheDocument()
    expect(within(tooltip).getByText('uniform')).toBeInTheDocument()
    expect(within(tooltip).getByText('10.0%')).toBeInTheDocument()
    expect(within(tooltip).getByText('500')).toBeInTheDocument()
    // The hovered bar gets a hairline outline on top of the ten fills.
    expect(container.querySelectorAll('rect')).toHaveLength(11)

    firePointer(svg, 'pointerleave')
    expect(tooltip).toHaveAttribute('data-active', 'false')
    expect(container.querySelectorAll('rect')).toHaveLength(10)
  })

  it('on touch, a tap shows the nearest bar and only a tap outside clears it', () => {
    mockChartBox(460, 190)
    const { container } = render(<PitHistogram buckets={flat()} label="margin" />)
    const svg = screen.getByRole('img')
    const tooltip = container.querySelector('[data-chart-tooltip]') as HTMLElement

    firePointer(svg, 'pointerdown', {
      clientX: 60,
      clientY: 100,
      pointerType: 'touch',
    })
    expect(tooltip).toHaveAttribute('data-active', 'true')

    // Lifting the finger fires a leave — which must NOT dismiss on touch, or
    // the tooltip would never be readable on the devices that need it most.
    firePointer(svg, 'pointerleave', { pointerType: 'touch' })
    expect(tooltip).toHaveAttribute('data-active', 'true')

    firePointer(document.body, 'pointerdown', { pointerType: 'touch' })
    expect(tooltip).toHaveAttribute('data-active', 'false')
  })

  it('snaps the win-probability crosshair to the nearest play state', () => {
    // 720-unit viewBox, plot from x=44 over 662 units; three points land at
    // x = 44, 375, 706. A move at 375 is the middle state, p = 0.3.
    mockChartBox(720, 220)
    const { container } = render(
      <WinProbabilityChart
        probability={curve([0.5, 0.3, 0.8])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    const svg = screen.getByRole('img')
    firePointer(svg, 'pointermove', { clientX: 375, clientY: 110 })

    expect(container.querySelector('[data-crosshair]')).toBeInTheDocument()
    const tooltip = container.querySelector('[data-chart-tooltip]') as HTMLElement
    expect(tooltip).toHaveAttribute('data-active', 'true')
    // Both sides, both values, always as text.
    expect(within(tooltip).getByText('BOS')).toBeInTheDocument()
    expect(within(tooltip).getByText('30.0%')).toBeInTheDocument()
    expect(within(tooltip).getByText('LAL')).toBeInTheDocument()
    expect(within(tooltip).getByText('70.0%')).toBeInTheDocument()
  })

  it('keeps the native <title> fallback under the styled layer', () => {
    const { container } = render(<PitHistogram buckets={flat()} label="margin" />)
    const titles = Array.from(container.querySelectorAll('rect > title'))
    expect(titles).toHaveLength(10)
    expect(titles[0].textContent).toMatch(/0\.0–0\.1/)
  })
})
