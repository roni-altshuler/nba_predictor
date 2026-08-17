import { render, screen } from '@testing-library/react'

import { PitHistogram } from '@/components/charts/PitHistogram'
import type { PitBucket } from '@/lib/artifacts'

/**
 * Guards on the two claims these surfaces make about their own limits.
 *
 * Both were built with a caveat that is the whole reason the number is
 * publishable at all — a comeback figure that is a lower bound, and a CLV
 * verdict that is allowed to say the value surface is not working. A caveat
 * that quietly disappears in a refactor turns an honest number into a false
 * one, which is exactly the failure mode this project spends its comments on.
 */

describe('PitHistogram scaling', () => {
  const flat: PitBucket[] = Array.from({ length: 10 }, (_, i) => ({
    lower: i / 10,
    upper: (i + 1) / 10,
    count: 100,
    share: 0.1,
    expected: 0.1,
  }))

  it('keeps an empty bin visible as zero rather than dropping it', () => {
    // Unlike the reliability table, an empty PIT bin is a FINDING: it means
    // nothing landed in that decile of the model's own distribution.
    const withGap = flat.map((b, i) =>
      i === 3 ? { ...b, count: 0, share: 0 } : b,
    )
    const { container } = render(<PitHistogram buckets={withGap} label="margin" />)
    expect(container.querySelectorAll('rect')).toHaveLength(10)
    const heights = Array.from(container.querySelectorAll('rect')).map((r) =>
      Number(r.getAttribute('height')),
    )
    expect(heights[3]).toBe(0)
  })

  it('never draws a bar taller than the plot', () => {
    const spike = flat.map((b, i) => (i === 0 ? { ...b, share: 1.0 } : b))
    const { container } = render(<PitHistogram buckets={spike} label="total" />)
    const plotHeight = 190 - 14 - 30
    for (const rect of Array.from(container.querySelectorAll('rect'))) {
      expect(Number(rect.getAttribute('height'))).toBeLessThanOrEqual(
        plotHeight + 0.001,
      )
    }
  })

  it('states the consequence of a failure, not just the mechanic', () => {
    render(<PitHistogram buckets={flat} label="margin" />)
    expect(screen.getByText(/overconfident/i)).toBeInTheDocument()
  })
})
