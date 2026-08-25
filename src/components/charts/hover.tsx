'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * The shared hover layer for every chart in the product.
 *
 * One mechanism, seven charts: a chart supplies a `locate` function that maps
 * a pointer position (in viewBox units) to the nearest thing worth naming —
 * a checkpoint, a dot, a bar — and gets back a crosshair position and a
 * tooltip whose values are ALWAYS text. The native `<title>` elements and the
 * `<details>` tables stay in place as the no-JS fallback; this layer is the
 * fast, styled, touch-capable path on top of them.
 *
 * **Pointer events, not mouse events**, so one code path covers mouse and
 * touch. On touch, a tap (`pointerdown`) shows the nearest point and a tap
 * outside the chart clears it — `pointerleave` only clears for mouse/pen,
 * because on touch it fires the moment the finger lifts, which would make the
 * tooltip unreadable on exactly the devices that need it most.
 *
 * **The only animation is `transition-opacity`.** This is feedback, not
 * decoration, and under `useReducedMotion` even that is dropped (globals.css
 * additionally collapses every duration under prefers-reduced-motion).
 */

export interface TooltipLine {
  label: string
  /** The value, ALWAYS as text — a tooltip never says anything colour-only. */
  value: string
  /** Series swatch colour, for charts where colour carries identity. */
  swatch?: string
  /** De-emphasised rows: the field, a reference, an absent value. */
  muted?: boolean
}

export interface HoverTarget {
  /** viewBox x of the snapped point — where the crosshair/highlight draws. */
  x: number
  /** viewBox y of the snapped point, for dot charts. */
  y?: number
  /** Tooltip header — a date, a team, a bin range. */
  title?: string
  lines: TooltipLine[]
}

export interface ActiveHover {
  target: HoverTarget
  /** Pointer position in CSS pixels, relative to the chart container. */
  px: number
  py: number
}

interface SvgHoverProps {
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void
  onPointerLeave: (event: ReactPointerEvent<SVGSVGElement>) => void
}

/**
 * Wire a chart's `<svg>` for hover. The chart wraps its svg in a
 * `relative`-positioned div carrying `containerRef`, spreads `svgProps` onto
 * the svg, draws its own crosshair/highlight from `active.target` (it knows
 * its own geometry), and mounts `<ChartTooltip active={active} />` beside the
 * svg.
 *
 * Coordinates: the svg fills its container's width and its viewBox aspect is
 * preserved, so one scale factor maps CSS pixels to viewBox units.
 */
export function useChartHover(
  viewW: number,
  locate: (vx: number, vy: number) => HoverTarget | null,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ActiveHover | null>(null)

  const handlePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (!rect.width) return
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const scale = viewW / rect.width
    const target = locate(px * scale, py * scale)
    setActive(target ? { target, px, py } : null)
  }

  const handleLeave = (event: ReactPointerEvent<SVGSVGElement>) => {
    // Touch "leaves" the moment the finger lifts; keep the tooltip up until
    // a tap lands outside instead.
    if (event.pointerType !== 'touch') setActive(null)
  }

  // A tap outside the chart clears a touch-opened tooltip.
  useEffect(() => {
    if (!active) return
    const onDown = (event: PointerEvent) => {
      const container = containerRef.current
      if (
        container &&
        event.target instanceof Node &&
        !container.contains(event.target)
      ) {
        setActive(null)
      }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [active])

  const svgProps: SvgHoverProps = {
    onPointerMove: handlePointer,
    onPointerDown: handlePointer,
    onPointerLeave: handleLeave,
  }

  return { containerRef, active, svgProps }
}

/** `useLayoutEffect` that is quiet during server rendering. */
const useIsoLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * The styled tooltip. Follows the pointer, clamps inside the chart box,
 * mono 11px with tabular numerals on `--background-tertiary` behind a
 * hairline. `aria-hidden` because everything it says is already carried by
 * the native `<title>` fallbacks, the aria-labels and the table views.
 */
export function ChartTooltip({ active }: { active: ActiveHover | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const lastTarget = useRef<HoverTarget | null>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (active) lastTarget.current = active.target
  }, [active])

  // Position after render, when the tooltip's size is measurable, so the
  // clamp works on the real box rather than a guess.
  useIsoLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement?.getBoundingClientRect()
    if (!el || !box || !active) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = active.px + 14
    if (left + w > box.width - 4) left = active.px - w - 14
    left = Math.min(Math.max(4, left), Math.max(4, box.width - w - 4))
    let top = active.py - h - 12
    if (top < 4) top = active.py + 16
    top = Math.min(Math.max(4, top), Math.max(4, box.height - h - 4))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [active])

  // While fading out, keep showing what was last under the pointer rather
  // than collapsing to an empty box mid-fade.
  const target = active?.target ?? lastTarget.current

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-chart-tooltip
      data-active={active ? 'true' : 'false'}
      className={`pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded border border-[var(--border-color)] bg-[var(--background-tertiary)] px-2.5 py-1.5${
        reduceMotion ? '' : ' transition-opacity duration-150'
      }`}
      style={{
        opacity: active ? 1 : 0,
        fontFamily: 'var(--font-mono-numeric), ui-monospace, monospace',
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.6,
      }}
    >
      {target ? (
        <>
          {target.title ? (
            <div
              className="mb-0.5 uppercase tracking-[0.1em] text-[var(--text-tertiary)]"
              style={{ fontSize: '10px' }}
            >
              {target.title}
            </div>
          ) : null}
          {target.lines.map((line, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4">
              <span className="inline-flex items-center gap-1.5">
                {line.swatch ? (
                  <span
                    aria-hidden="true"
                    className="inline-block h-0.5 w-3 shrink-0"
                    style={{ background: line.swatch }}
                  />
                ) : null}
                <span
                  className={
                    line.muted
                      ? 'text-[var(--text-tertiary)]'
                      : 'text-[var(--text-secondary)]'
                  }
                >
                  {line.label}
                </span>
              </span>
              <span
                className={
                  line.muted
                    ? 'text-[var(--text-tertiary)]'
                    : 'text-[var(--text-primary)]'
                }
              >
                {line.value}
              </span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

/** The vertical hairline that marks the snapped x on a line chart. */
export function Crosshair({
  x,
  top,
  bottom,
}: {
  x: number
  top: number
  bottom: number
}) {
  return (
    <line
      data-crosshair
      x1={x}
      x2={x}
      y1={top}
      y2={bottom}
      stroke="var(--border-hover)"
      strokeWidth="1"
    />
  )
}

/**
 * A hairline ring around the nearest dot. White because it is emphasis, not
 * meaning — colour on this site only ever carries meaning.
 */
export function HighlightRing({
  x,
  y,
  r = 6,
}: {
  x: number
  y: number
  r?: number
}) {
  return (
    <circle
      data-highlight
      cx={x}
      cy={y}
      r={r}
      fill="none"
      stroke="var(--text-primary)"
      strokeWidth="1"
    />
  )
}

/** A small filled marker on a line series at the snapped x. */
export function HighlightDot({
  x,
  y,
  color,
}: {
  x: number
  y: number
  color: string
}) {
  return (
    <circle
      data-highlight
      cx={x}
      cy={y}
      r="3.5"
      fill={color}
      stroke="var(--viz-surface)"
      strokeWidth="1.5"
    />
  )
}

/**
 * The one empty state every chart shares. An eyebrow-styled line naming what
 * is missing, so a missing artifact reads as a fact about the data and never
 * as a layout bug — and never as silence.
 */
export function ChartEmptyState({ children }: { children: ReactNode }) {
  return (
    <p data-chart-empty className="eyebrow">
      {children}
    </p>
  )
}

/** Index of the nearest value in `xs` to `vx`. `xs` need not be sorted. */
export function nearestIndex(xs: number[], vx: number): number {
  let best = 0
  for (let i = 1; i < xs.length; i += 1) {
    if (Math.abs(xs[i] - vx) < Math.abs(xs[best] - vx)) best = i
  }
  return best
}
