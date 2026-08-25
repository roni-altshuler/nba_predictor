'use client'

import { useEffect, useRef } from 'react'

/**
 * The chalk court: Hardwood's animated ambient layer, the sibling of
 * Gridiron's `ChalkboardField`.
 *
 * A fixed canvas at z-index -1 — behind every in-flow element, above the
 * body's black. It draws a sparse set of faint court baselines, and every
 * few seconds a dim chalk half-court play: a baseline, the key, the
 * free-throw circle and the three-point arc fade in with five O's around
 * the arc and five X's inside them, then one O cuts to the basket — the
 * route draws itself in the model's green, holds, and fades. The board
 * lives in the page's margins; cards and chrome are opaque, so no number
 * is ever read through it.
 *
 * It shares the sanction and the guardrails of the ambient hardwood layer
 * (docs/DESIGN.md §6–6a): chalk-dust alphas only, one small figure at a
 * time, never under a number — the surfaces above it are opaque by
 * design-system rule.
 *
 * Lifecycle discipline ported verbatim from the NFL sibling's chalkboard:
 * devicePixelRatio capped at 2; requestAnimationFrame only runs while the
 * board is live (a hidden tab stops it); ResizeObserver relayouts; and
 * under prefers-reduced-motion the board draws one static frame — the
 * baselines plus a finished play — and never moves.
 */

const DPR_CAP = 2
const BASELINE_GAP = 180 // px between the static court baselines

// Arena re-theme (2026-08-25): the owner asked for the theme to be SEEN,
// so the caps rose with DESIGN.md §6a — static layer now stays ≤ 0.12,
// play figures ≤ 0.45 at peak. Contrast is untouched: every surface that
// carries a number is opaque and paints over this canvas.
const LINE_ALPHA = 0.11 // static baselines
const ARC_ALPHA = 0.08 // the tiny centre circles on some of them
const PLAY_ALPHA = 0.42 // court sketch, O's and X's at peak
const ROUTE_ALPHA = 0.6 // the one cut, in the accent

// Phase lengths, ms. One play runs ~6s and then the board rests.
const FADE_IN = 600
const DRAW = 2200
const HOLD = 1900
const FADE_OUT = 1500
const REST_MIN = 3500
const REST_RANGE = 4000

interface Point {
  x: number
  y: number
}

interface Play {
  /** Baseline centre — the basket sits on it and the court extends up. */
  ax: number
  ay: number
  /** Precomputed hand-ruled sag for the baseline. */
  sag: number
  os: Point[]
  xs: Point[]
  /** Give-and-go only: a short dashed pass line, drawn before the cut. */
  pass: [Point, Point] | null
  route: Point[]
  routeLength: number
  born: number
}

/** The model's green, read from the live token so the palette cascades. */
function routeColor(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-primary')
    .trim()
  return raw || '#5fa657'
}

function segmentLengths(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

/**
 * A random chalk half-court play. The sketch is anchored on a baseline at
 * (ax, ay): the key is ~60x50, the free-throw circle caps it, the
 * three-point arc spans ~170px, five O's stand around the arc (corners,
 * wings, top) and five X's guard inside them. One O — a wing or a corner —
 * cuts to the basket with a single direction change; sometimes it gives to
 * a neighbour first (a short dashed pass) and then goes.
 */
function makePlay(width: number, height: number, now: number): Play {
  const margin = 120
  const ax = margin + Math.random() * Math.max(width - margin * 2, 1)
  const ay = height * 0.32 + Math.random() * height * 0.55 // keep off the top chrome

  const jitter = () => (Math.random() - 0.5) * 6

  // Corner left, wing left, top, wing right, corner right — angles on the
  // upper semicircle (canvas y grows downward, so PI..2PI is above ay).
  const spots = [
    Math.PI + 0.12,
    Math.PI + 0.62,
    Math.PI * 1.5,
    Math.PI * 2 - 0.62,
    Math.PI * 2 - 0.12,
  ]
  const os: Point[] = spots.map((a) => ({
    x: ax + Math.cos(a) * 97 + jitter(),
    y: ay + Math.sin(a) * 97 + jitter(),
  }))
  const xs: Point[] = spots.map((a) => ({
    x: ax + Math.cos(a) * 56 + jitter(),
    y: ay + Math.sin(a) * 56 + jitter(),
  }))

  // The cutter is a wing or a corner, never the top.
  const driverIdx = [0, 1, 3, 4][Math.floor(Math.random() * 4)]
  const driver = os[driverIdx]
  const side = driver.x < ax ? -1 : 1
  const corner = driverIdx === 0 || driverIdx === 4

  // One direction change: a corner drives the baseline to the short corner
  // then finishes; a wing drives to the elbow then cuts to the rim.
  const mid: Point = corner
    ? { x: ax + side * 36 + jitter(), y: ay - 16 + jitter() }
    : { x: ax + side * 30 + jitter(), y: ay - 58 + jitter() }
  const rim: Point = { x: ax + side * 3, y: ay - 18 }
  const route: Point[] = [{ x: driver.x, y: driver.y - 4 }, mid, rim]

  // Give-and-go: a short pass to the neighbouring O, then the cut.
  let pass: [Point, Point] | null = null
  if (Math.random() < 0.45) {
    const neighbour = os[corner ? (driverIdx === 0 ? 1 : 3) : 2]
    pass = [
      { x: driver.x, y: driver.y },
      {
        x: driver.x + (neighbour.x - driver.x) * 0.86,
        y: driver.y + (neighbour.y - driver.y) * 0.86,
      },
    ]
  }

  return {
    ax,
    ay,
    sag: (Math.random() * 2 - 1) * 3,
    os,
    xs,
    pass,
    route,
    routeLength: segmentLengths(route),
    born: now,
  }
}

export function CourtField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const state = {
      dpr: Math.min(window.devicePixelRatio || 1, DPR_CAP),
      width: 0,
      height: 0,
      static: null as HTMLCanvasElement | null,
      play: null as Play | null,
      restUntil: 0,
      reducedMotion: false,
      rafId: 0,
      running: false,
      route: routeColor(),
    }

    /* The static layer is chalk too, and deliberately quieter than the
       plays: sparse horizontal court baselines, each with a tiny precomputed
       sag so it reads hand-ruled, and a tiny centre circle straddling some
       of them. Rendered once to an offscreen canvas and blitted, so a frame
       is one drawImage plus the play's strokes. */
    const buildStatic = () => {
      const off = document.createElement('canvas')
      off.width = Math.max(Math.floor(state.width * state.dpr), 1)
      off.height = Math.max(Math.floor(state.height * state.dpr), 1)
      const g = off.getContext('2d')
      if (!g) return
      g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
      g.lineWidth = 1

      for (let y = BASELINE_GAP * 0.7; y < state.height; y += BASELINE_GAP) {
        const sag = Math.random() * 2 - 1
        g.strokeStyle = `rgba(255,255,255,${LINE_ALPHA})`
        g.beginPath()
        g.moveTo(0, y)
        g.quadraticCurveTo(state.width / 2, y + sag * 3, state.width, y + sag)
        g.stroke()

        // A tiny centre circle on some baselines — the half-court motif.
        if (Math.random() < 0.45) {
          const cx = 60 + Math.random() * Math.max(state.width - 120, 1)
          g.strokeStyle = `rgba(255,255,255,${ARC_ALPHA})`
          g.beginPath()
          g.arc(cx, y, 12 + Math.random() * 4, 0, Math.PI * 2)
          g.stroke()
        }
      }
      state.static = off
    }

    const layout = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      state.width = w
      state.height = h
      canvas.width = Math.floor(w * state.dpr)
      canvas.height = Math.floor(h * state.dpr)
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
      buildStatic()
    }

    const drawMark = (p: Point, kind: 'o' | 'x') => {
      ctx.beginPath()
      if (kind === 'o') {
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
      } else {
        ctx.moveTo(p.x - 5, p.y - 5)
        ctx.lineTo(p.x + 5, p.y + 5)
        ctx.moveTo(p.x + 5, p.y - 5)
        ctx.lineTo(p.x - 5, p.y + 5)
      }
      ctx.stroke()
    }

    /** The half-court sketch: baseline, key, free-throw circle, arc, rim. */
    const drawCourt = (play: Play) => {
      const { ax, ay } = play
      // Baseline, hand-ruled.
      ctx.beginPath()
      ctx.moveTo(ax - 95, ay)
      ctx.quadraticCurveTo(ax, ay + play.sag, ax + 95, ay)
      ctx.stroke()
      // The key.
      ctx.strokeRect(ax - 30, ay - 50, 60, 50)
      // Free-throw semicircle, opening away from the baseline.
      ctx.beginPath()
      ctx.arc(ax, ay - 50, 25, Math.PI, Math.PI * 2)
      ctx.stroke()
      // Three-point arc, ~170px across.
      ctx.beginPath()
      ctx.arc(ax, ay, 85, Math.PI, Math.PI * 2)
      ctx.stroke()
      // Backboard and rim.
      ctx.beginPath()
      ctx.moveTo(ax - 8, ay - 9)
      ctx.lineTo(ax + 8, ay - 9)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(ax, ay - 14, 4, 0, Math.PI * 2)
      ctx.stroke()
    }

    const drawRoute = (play: Play, progress: number) => {
      ctx.save()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = state.route

      // The give: a short dashed pass, on the board before the cut starts.
      if (play.pass) {
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(play.pass[0].x, play.pass[0].y)
        ctx.lineTo(play.pass[1].x, play.pass[1].y)
        ctx.stroke()
      }

      // The go: dash-offset progressive drawing, same as the NFL sibling.
      ctx.setLineDash([play.routeLength])
      ctx.lineDashOffset = play.routeLength * (1 - progress)
      ctx.beginPath()
      ctx.moveTo(play.route[0].x, play.route[0].y)
      for (let i = 1; i < play.route.length; i++) {
        ctx.lineTo(play.route[i].x, play.route[i].y)
      }
      ctx.stroke()
      ctx.setLineDash([])

      if (progress >= 0.98) {
        const tip = play.route[play.route.length - 1]
        const prev = play.route[play.route.length - 2]
        const angle = Math.atan2(tip.y - prev.y, tip.x - prev.x)
        ctx.beginPath()
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(tip.x - 8 * Math.cos(angle - 0.45), tip.y - 8 * Math.sin(angle - 0.45))
        ctx.moveTo(tip.x, tip.y)
        ctx.lineTo(tip.x - 8 * Math.cos(angle + 0.45), tip.y - 8 * Math.sin(angle + 0.45))
        ctx.stroke()
      }
      ctx.restore()
    }

    /** Frame alpha and route progress for a play `age` ms old, or null when done. */
    const phase = (age: number): { alpha: number; progress: number } | null => {
      if (age < FADE_IN) return { alpha: age / FADE_IN, progress: 0 }
      if (age < FADE_IN + DRAW) return { alpha: 1, progress: (age - FADE_IN) / DRAW }
      if (age < FADE_IN + DRAW + HOLD) return { alpha: 1, progress: 1 }
      const out = age - FADE_IN - DRAW - HOLD
      if (out < FADE_OUT) return { alpha: 1 - out / FADE_OUT, progress: 1 }
      return null
    }

    const drawFrame = (now: number, still = false) => {
      ctx.clearRect(0, 0, state.width, state.height)
      if (state.static) {
        ctx.drawImage(state.static, 0, 0, state.width, state.height)
      }
      const play = state.play
      if (!play) return
      const p = still ? { alpha: 1, progress: 1 } : phase(now - play.born)
      if (!p) {
        state.play = null
        state.restUntil = now + REST_MIN + Math.random() * REST_RANGE
        return
      }
      ctx.lineWidth = 1.5
      ctx.globalAlpha = p.alpha
      ctx.strokeStyle = `rgba(255,255,255,${PLAY_ALPHA})`
      drawCourt(play)
      play.os.forEach((o) => drawMark(o, 'o'))
      play.xs.forEach((x) => drawMark(x, 'x'))
      ctx.globalAlpha = p.alpha * ROUTE_ALPHA
      if (p.progress > 0) drawRoute(play, Math.min(p.progress, 1))
      ctx.globalAlpha = 1
    }

    const loop = (now: number) => {
      if (!state.play && now >= state.restUntil) {
        state.play = makePlay(state.width, state.height, now)
      }
      drawFrame(now)
      state.rafId = requestAnimationFrame(loop)
    }

    const start = () => {
      if (state.running || state.reducedMotion) return
      state.running = true
      state.rafId = requestAnimationFrame(loop)
    }
    const stop = () => {
      state.running = false
      cancelAnimationFrame(state.rafId)
    }

    const drawStill = () => {
      state.play = makePlay(state.width, state.height, 0)
      drawFrame(0, true)
    }

    const handleVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleMotion = () => {
      state.reducedMotion = motionQuery.matches
      if (state.reducedMotion) {
        stop()
        drawStill()
      } else {
        start()
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      layout()
      if (state.reducedMotion) drawStill()
    })

    layout()
    state.restUntil = performance.now() + 1200
    handleMotion()
    resizeObserver.observe(document.documentElement)
    motionQuery.addEventListener('change', handleMotion)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
      motionQuery.removeEventListener('change', handleMotion)
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    />
  )
}

export default CourtField
