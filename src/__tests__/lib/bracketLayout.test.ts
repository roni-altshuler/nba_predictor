import { CARD_H, centreY, planBracket, roundName } from '@/lib/bracketLayout'

/**
 * The assertion that gives bracketLayout its reason to exist.
 *
 * Built from nested flexbox, whether a card sits on the centre line between
 * the two feeding it is an emergent property of the box model — it looks
 * about right and nothing can check it. Computed, it is arithmetic, and
 * arithmetic can be asserted.
 */
describe('planBracket', () => {
  const geometry = planBracket(3)

  it('places four first-round series per conference, not eight', () => {
    // Eight teams per conference meet in FOUR series. The exponent counts
    // series in the round; getting it off by one rendered four empty
    // placeholder cards under every real one.
    const firstRound = geometry.nodes.filter(
      (n) => n.depth === 3 && n.side === 'left',
    )
    expect(firstRound).toHaveLength(4)
  })

  it('has the full NBA shape: 4 + 2 + 1 per side, plus the Finals', () => {
    for (const side of ['left', 'right'] as const) {
      expect(
        geometry.nodes.filter((n) => n.side === side && n.depth === 3),
      ).toHaveLength(4)
      expect(
        geometry.nodes.filter((n) => n.side === side && n.depth === 2),
      ).toHaveLength(2)
      expect(
        geometry.nodes.filter((n) => n.side === side && n.depth === 1),
      ).toHaveLength(1)
    }
    expect(geometry.nodes.filter((n) => n.side === 'centre')).toHaveLength(1)
    expect(geometry.nodes).toHaveLength(4 + 2 + 1 + 4 + 2 + 1 + 1)
  })

  it.each(['left', 'right'] as const)(
    'on the %s half, a card sits exactly halfway between the two feeding it',
    (side) => {
      for (const depth of [3, 2]) {
        const parentDepth = depth - 1
        const round = geometry.nodes.filter(
          (n) => n.side === side && n.depth === depth,
        )
        for (let slot = 0; slot < round.length; slot += 2) {
          const a = round.find((n) => n.slot === slot)!
          const b = round.find((n) => n.slot === slot + 1)!
          const parent = geometry.nodes.find(
            (n) =>
              n.side === side && n.depth === parentDepth && n.slot === slot / 2,
          )!
          expect(centreY(parent)).toBeCloseTo((centreY(a) + centreY(b)) / 2, 6)
        }
      }
    },
  )

  it('mirrors: the two halves are reflections about the centre line', () => {
    for (const depth of [3, 2, 1]) {
      const left = geometry.nodes.filter(
        (n) => n.side === 'left' && n.depth === depth,
      )
      const right = geometry.nodes.filter(
        (n) => n.side === 'right' && n.depth === depth,
      )
      expect(left).toHaveLength(right.length)
      for (const node of left) {
        const twin = right.find((n) => n.slot === node.slot)!
        expect(node.x + twin.x + node.width).toBeCloseTo(geometry.width, 6)
        expect(node.y).toBeCloseTo(twin.y, 6)
      }
    }
  })

  it('puts the Finals dead centre', () => {
    const finals = geometry.nodes.find((n) => n.side === 'centre')!
    expect(finals.x + finals.width / 2).toBeCloseTo(geometry.width / 2, 6)
    expect(finals.y + finals.height / 2).toBeCloseTo(geometry.height / 2, 6)
  })

  it('never overlaps two cards in the same round', () => {
    for (const side of ['left', 'right'] as const) {
      for (const depth of [3, 2]) {
        const round = geometry.nodes
          .filter((n) => n.side === side && n.depth === depth)
          .sort((a, b) => a.y - b.y)
        for (let i = 1; i < round.length; i += 1) {
          expect(round[i].y).toBeGreaterThanOrEqual(round[i - 1].y + CARD_H)
        }
      }
    }
  })

  it('fits the content shell at desktop width', () => {
    // The shell is 1160px and card padding takes 32 of it. A board wider than
    // this pans, which is correct but worse — this pins that the default NBA
    // board does not need to.
    expect(geometry.width).toBeLessThanOrEqual(1128)
  })

  it('emits a connector for every merge plus both conference finals', () => {
    // Two merges into the semis and one into the conference final, per side,
    // plus one conference-final-to-Finals path per side.
    expect(geometry.connectors).toHaveLength((2 + 1) * 2 + 2)
  })
})

describe('roundName', () => {
  it('derives the name from depth, never from a source label', () => {
    expect(roundName(0)).toBe('NBA Finals')
    expect(roundName(1)).toBe('Conference Finals')
    expect(roundName(2)).toBe('Conference Semifinals')
    expect(roundName(3)).toBe('First Round')
  })
})
