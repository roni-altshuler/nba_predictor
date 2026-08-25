/**
 * The ambient hardwood layer — the one place this product decorates.
 *
 * A faint half-court line drawing (center circle, half-court line, the key,
 * the three-point arc) and two slow ember glows in the wood tones the chart
 * ramp already owns. Sanctioned 2026-08-25 at the owner's request as a
 * deliberate exception to "no gradients": the canvas should feel like the
 * sport, not like a void. The constraints that keep it Bugatti are enforced
 * in globals.css and documented in docs/DESIGN.md §6:
 *
 * - strokes and washes never exceed ~7% opacity — content contrast is
 *   untouched, and every card surface is opaque and sits above this layer
 * - the only motion is transform on the glows, with 50s+ periods — weather,
 *   not animation; under prefers-reduced-motion it freezes to a static wash
 * - z-index is negative and pointer-events are off: it can never intercept
 *   a tap or sit over content
 *
 * Server component, zero JS shipped.
 */
export function AmbientBackground() {
  return (
    <div className="ambient-court" aria-hidden="true">
      <div className="ambient-glow ambient-glow-a" />
      <div className="ambient-glow ambient-glow-b" />
      <svg
        className="ambient-lines"
        viewBox="0 0 1200 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="var(--court-line)"
        strokeWidth="1.5"
      >
        {/* half-court line */}
        <line x1="-40" y1="290" x2="1240" y2="290" />
        {/* center circle, both rings */}
        <circle cx="600" cy="290" r="150" />
        <circle cx="600" cy="290" r="50" />
        {/* the key: lane, free-throw line and circle */}
        <rect x="495" y="700" width="210" height="240" />
        <circle cx="600" cy="700" r="76" />
        {/* three-point arc, sweeping off the bottom edge */}
        <path d="M 132 940 A 500 500 0 0 1 1068 940" />
        {/* restricted-area arc under the (offscreen) rim */}
        <path d="M 548 940 A 52 52 0 0 1 652 940" />
      </svg>
    </div>
  )
}
