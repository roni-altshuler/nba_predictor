import { moneyline, num, pct, signed, spread } from '@/lib/format'

describe('pct', () => {
  it('renders a probability as text', () => {
    expect(pct(0.635)).toBe('63.5%')
    expect(pct(0.5, 0)).toBe('50%')
  })

  it('renders absent data as absent, never as zero', () => {
    // A missing probability and a 0% probability are different facts. If
    // this ever returns '0.0%' the page starts asserting something the
    // model never said.
    expect(pct(null)).toBe('—')
    expect(pct(undefined)).toBe('—')
    expect(pct(Number.NaN)).toBe('—')
  })

  it('still renders a genuine zero', () => {
    expect(pct(0)).toBe('0.0%')
  })
})

describe('signed', () => {
  it('always shows the sign', () => {
    expect(signed(3.2)).toBe('+3.2')
    expect(signed(-3.2)).toBe('-3.2')
    expect(signed(0)).toBe('+0.0')
  })
})

describe('moneyline', () => {
  it('keeps the sign a bettor expects', () => {
    expect(moneyline(-218)).toBe('-218')
    expect(moneyline(180)).toBe('+180')
  })

  it('renders a missing price as missing', () => {
    expect(moneyline(null)).toBe('—')
  })
})

describe('spread', () => {
  it('shows a pick em rather than a zero', () => {
    // "0" beside a spread reads as missing data; PK is the term the market
    // itself uses.
    expect(spread(0)).toBe('PK')
  })

  it('signs from the home perspective', () => {
    expect(spread(-5.5)).toBe('-5.5')
    expect(spread(5.5)).toBe('+5.5')
  })

  it('renders a missing line as missing', () => {
    expect(spread(null)).toBe('—')
  })
})

describe('num', () => {
  it('respects the requested precision', () => {
    expect(num(0.20698, 4)).toBe('0.2070')
    expect(num(228.34, 1)).toBe('228.3')
  })

  it('renders absent data as absent', () => {
    expect(num(undefined, 4)).toBe('—')
  })
})
