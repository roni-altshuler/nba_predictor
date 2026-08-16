import { render, screen } from '@testing-library/react'

import { PitHistogram } from '@/components/charts/PitHistogram'
import { WinProbabilityChart } from '@/components/charts/WinProbabilityChart'
import type { PitBucket } from '@/lib/artifacts'
import type { WinProbability } from '@/lib/espn'

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

  it('renders nothing for a curve too short to be a curve', () => {
    const { container } = render(
      <WinProbabilityChart
        probability={curve([0.5])}
        homeLabel="BOS"
        awayLabel="LAL"
      />,
    )
    expect(container).toBeEmptyDOMElement()
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
