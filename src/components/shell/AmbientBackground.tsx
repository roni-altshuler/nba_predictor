/**
 * The ambient floor — the still half of the decorated canvas.
 *
 * Two slow ember glows in the wood tones the chart ramp already owns,
 * drifting over the plank-seamed walnut that globals.css paints on
 * `.ambient-court`. The court itself is no longer drawn here: since the
 * chalk game arrived (`CourtField.tsx`), the game's own full court IS the
 * court, and a second static one underneath it read as clutter.
 *
 * Guardrails (docs/DESIGN.md §6): low-alpha washes only, transform-only
 * motion on 50s+ periods, negative z-index, pointer-events off, and
 * explicit `animation: none` under prefers-reduced-motion. Server
 * component, zero JS shipped.
 */
export function AmbientBackground() {
  return (
    <div className="ambient-court" aria-hidden="true">
      <div className="ambient-glow ambient-glow-a" />
      <div className="ambient-glow ambient-glow-b" />
    </div>
  )
}
