/**
 * Bracket geometry — computed, never laid out.
 *
 * Every card position and every connector path is arithmetic. The component
 * absolutely positions from this and draws one `<svg>` underneath.
 *
 * **Why not nested flexbox.** The obvious implementation builds the shape
 * from nested rows with `h-1/2` bordered divs for connectors. That gets a
 * bracket approximately right and cannot be checked: whether a card sits on
 * the centre line between the two feeding it becomes an emergent property
 * of the box model rather than something anyone asserted. Here it is a
 * test — the card at slot `s` sits exactly halfway between `2s` and `2s+1`,
 * on both halves of a mirrored board.
 *
 * The NBA bracket is 16 teams over four rounds, mirrored: the Eastern half
 * flows left-to-right, the Western half right-to-left, and the Finals sit in
 * the middle. That is the shape the league itself publishes, and it is what
 * makes the two conferences readable as separate races.
 */

export interface BracketNode {
  /** Depth from the final: 0 = Finals, 1 = conference finals, 3 = round 1. */
  depth: number
  /** Slot within the round, 0-indexed from the top. */
  slot: number
  side: 'left' | 'right' | 'centre'
  x: number
  y: number
  width: number
  height: number
}

export interface BracketGeometry {
  width: number
  height: number
  nodes: BracketNode[]
  connectors: string[]
}

/*
 * Card metrics.
 *
 * Sized so the whole mirrored board fits the 1160px content shell at
 * desktop without panning: six columns of (CARD_W + COL_GAP) plus the
 * centre column comes to 1124px, inside the 1128px the shell leaves after
 * card padding.
 *
 * **It still pans rather than shrinking when it does not fit.** Below the
 * shell width the board scrolls horizontally; it is never scaled down by a
 * transform. A bracket rendered at two-thirds size is the one thing a
 * reader came to this page for, drawn too small to read.
 */
export const CARD_W = 140
export const CARD_H = 50
export const COL_GAP = 18
export const ROW_GAP = 18

/**
 * Lay out a mirrored 16-team bracket.
 *
 * `roundsPerSide` counts the rounds inside ONE conference: 3 for the NBA —
 * first round, conference semi-finals, conference finals — with the Finals
 * added in the centre.
 *
 * **The first round has 2^(rounds-1) series, not 2^rounds.** Eight teams
 * per conference meet in FOUR series; the exponent counts the series in the
 * round, and the round after the last one is the single conference final.
 * Getting this off by one renders four empty placeholder cards under every
 * real one — which is exactly what the first version did.
 */
export function planBracket(roundsPerSide = 3): BracketGeometry {
  const firstRoundSlots = 2 ** (roundsPerSide - 1) // 4 series per conference
  const laneH = CARD_H + ROW_GAP
  const sideHeight = firstRoundSlots * laneH

  const colW = CARD_W + COL_GAP
  // Columns per side, plus the centre column for the Finals.
  const width = colW * roundsPerSide * 2 + CARD_W + COL_GAP * 2
  const height = sideHeight

  const nodes: BracketNode[] = []
  const connectors: string[] = []

  for (const side of ['left', 'right'] as const) {
    for (let round = 0; round < roundsPerSide; round += 1) {
      // depth counts DOWN toward the final: round 0 is the outermost.
      const depth = roundsPerSide - round
      const slots = firstRoundSlots / 2 ** round
      const slotH = sideHeight / slots

      for (let slot = 0; slot < slots; slot += 1) {
        const y = slot * slotH + slotH / 2 - CARD_H / 2
        const x =
          side === 'left'
            ? round * colW
            : width - CARD_W - round * colW

        nodes.push({ depth, slot, side, x, y, width: CARD_W, height: CARD_H })
      }
    }
  }

  // The Finals, dead centre.
  const centreX = width / 2 - CARD_W / 2
  const centreY = height / 2 - CARD_H / 2
  nodes.push({
    depth: 0, slot: 0, side: 'centre',
    x: centreX, y: centreY, width: CARD_W, height: CARD_H,
  })

  // Elbow connectors between a card and the two that feed it.
  for (const side of ['left', 'right'] as const) {
    for (let round = 0; round < roundsPerSide - 1; round += 1) {
      const depth = roundsPerSide - round
      const parentDepth = depth - 1
      const slots = firstRoundSlots / 2 ** round

      for (let slot = 0; slot < slots; slot += 2) {
        const a = find(nodes, side, depth, slot)
        const b = find(nodes, side, depth, slot + 1)
        const parent = find(nodes, side, parentDepth, slot / 2)
        if (!a || !b || !parent) continue
        connectors.push(elbow(a, b, parent, side))
      }
    }

    // Conference final into the Finals card.
    const conferenceFinal = find(nodes, side, 1, 0)
    const finals = nodes.find((n) => n.side === 'centre')
    if (conferenceFinal && finals) {
      const fromX =
        side === 'left'
          ? conferenceFinal.x + conferenceFinal.width
          : conferenceFinal.x
      const toX = side === 'left' ? finals.x : finals.x + finals.width
      const fromY = conferenceFinal.y + conferenceFinal.height / 2
      const toY = finals.y + finals.height / 2
      const midX = (fromX + toX) / 2
      connectors.push(
        `M${fromX},${fromY} H${midX} V${toY} H${toX}`,
      )
    }
  }

  return { width, height, nodes, connectors }
}

function find(
  nodes: BracketNode[],
  side: 'left' | 'right',
  depth: number,
  slot: number,
): BracketNode | undefined {
  return nodes.find(
    (n) => n.side === side && n.depth === depth && n.slot === slot,
  )
}

/**
 * An elbow from two sibling cards into the card they feed.
 *
 * The vertical segment sits at the midpoint of the gap between the columns,
 * so connectors never cross a card.
 */
function elbow(
  a: BracketNode,
  b: BracketNode,
  parent: BracketNode,
  side: 'left' | 'right',
): string {
  const aOut = side === 'left' ? a.x + a.width : a.x
  const bOut = side === 'left' ? b.x + b.width : b.x
  const parentIn = side === 'left' ? parent.x : parent.x + parent.width
  const midX = (aOut + parentIn) / 2

  const aY = a.y + a.height / 2
  const bY = b.y + b.height / 2
  const parentY = parent.y + parent.height / 2

  return [
    `M${aOut},${aY} H${midX}`,
    `M${bOut},${bY} H${midX}`,
    `M${midX},${aY} V${bY}`,
    `M${midX},${parentY} H${parentIn}`,
  ].join(' ')
}

/**
 * The vertical centre of a card, for the assertion that gives this module
 * its reason to exist.
 */
export function centreY(node: BracketNode): number {
  return node.y + node.height / 2
}

/**
 * Round names, DERIVED from depth rather than parsed from a label.
 *
 * ESPN's own vocabulary for these rounds is inconsistent across seasons —
 * "1st Round", "West Conf Semifinals", "Conference Semifinals" — so any
 * code that maps a phase string to a bracket position is wrong in the
 * seasons nobody checks. Depth is counted, and the name is a function of it.
 */
export function roundName(depth: number): string {
  if (depth === 0) return 'NBA Finals'
  if (depth === 1) return 'Conference Finals'
  if (depth === 2) return 'Conference Semifinals'
  if (depth === 3) return 'First Round'
  return `Round ${depth}`
}
