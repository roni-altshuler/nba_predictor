import { render, screen } from '@testing-library/react'

import { StatTile } from '@/components/primitives/StatTile'

/**
 * The one stat tile that replaced nine local copies. The semantics prop is
 * the part a refactor could silently lose: identical pixels were rendered
 * as `<p>/<p>` in some copies and `<dt>/<dd>` in others, and a `<dt>`
 * outside a `<dl>` (or a bare `<p>` inside one) is invalid HTML that no
 * screenshot will ever catch.
 */
describe('StatTile', () => {
  it('renders <p> semantics by default', () => {
    const { container } = render(<StatTile label="Record">{'52–30'}</StatTile>)
    expect(container.querySelector('dt')).toBeNull()
    const label = screen.getByText('Record')
    expect(label.tagName).toBe('P')
    expect(label).toHaveClass('eyebrow')
    const value = screen.getByText('52–30')
    expect(value.tagName).toBe('P')
    expect(value).toHaveClass('numeric')
  })

  it('renders <dt>/<dd> inside a <dl>', () => {
    render(
      <dl>
        <StatTile dl label="Games scored">
          {'14,600'}
        </StatTile>
      </dl>,
    )
    expect(screen.getByText('Games scored').tagName).toBe('DT')
    expect(screen.getByText('14,600').tagName).toBe('DD')
  })

  it('keeps the default value styling when no override is passed', () => {
    render(<StatTile label="Elo">{'1650'}</StatTile>)
    expect(screen.getByText('1650')).toHaveClass('mt-0.5', 'text-sm')
  })

  it('an override REPLACES the default spacing pair, never merges with it', () => {
    // Two margin utilities on one element would leave the winner to
    // stylesheet order — the exact pixel drift this primitive exists to end.
    render(
      <StatTile label="Elo" valueClassName="mt-1 text-lg">
        {'1650'}
      </StatTile>,
    )
    const value = screen.getByText('1650')
    expect(value).toHaveClass('mt-1', 'text-lg')
    expect(value).not.toHaveClass('mt-0.5')
    expect(value).not.toHaveClass('text-sm')
  })

  it('renders the hint line only when one is given', () => {
    const { container, rerender } = render(
      <StatTile label="Gap" hint="Brier, lower is better">
        {'+0.0071'}
      </StatTile>,
    )
    expect(screen.getByText('Brier, lower is better')).toBeInTheDocument()
    rerender(<StatTile label="Gap">{'+0.0071'}</StatTile>)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })
})
