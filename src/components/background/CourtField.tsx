'use client'

import { useEffect, useRef } from 'react'

/**
 * The chalk game: Hardwood's animated ambient layer.
 *
 * A fixed canvas at z-index -1 — behind every in-flow element, above the
 * body's walnut. It draws one full chalk court and, on it, a perpetual
 * dim five-on-five (2026-08-25, owner request): the O team in white chalk,
 * the X team in amber, the ball in the brand orange. Possessions flow end
 * to end — the offense advances, spreads to its spots while the defense
 * drops and matches up, the ball swings, somebody cuts, somebody rises;
 * a make gets its swish and a soft ring at the rim, a miss gets a
 * defensive board, and everyone turns and runs the other way. It is a
 * playbook that never stops being drawn.
 *
 * What keeps it a background and not a broadcast:
 * - **No digits, ever.** A score in the background is a number, and every
 *   number on this site is a claim. The bucket itself is the payoff.
 * - Chalk-dust alphas only (court ≤ 0.30, players ≤ 0.45, ball ≤ 0.60),
 *   and every surface that carries a number is opaque and paints over it.
 * - The simulation is slow — a possession runs eight to twelve seconds —
 *   and rendering is capped near 30fps.
 * - `requestAnimationFrame` only runs while the tab is visible; reduced
 *   motion gets a single mid-possession still frame and no motion at all.
 *
 * Lifecycle discipline ported from the NFL sibling's chalkboard:
 * devicePixelRatio capped at 2, ResizeObserver relayout (which restarts
 * the game on the new floor), everything torn down on unmount.
 */

const DPR_CAP = 2
const FPS_INTERVAL = 33 // ~30fps — an ambient layer does not need 60

// Alphas — the caps documented in DESIGN.md §6a.
const COURT_ALPHA = 0.3
const O_ALPHA = 0.45 // white chalk team
const X_ALPHA = 0.45 // amber chalk team
const BALL_ALPHA = 0.6

const X_CHALK = '226, 136, 47' // the amber the wood ramp already owns

// Pace, ms. A possession is advance + settle + a few swings + the shot.
const ADVANCE_MS = 2400
const SETTLE_MS = 900
const DWELL_MIN = 700
const DWELL_RANGE = 600
const PASS_MS = 420
const SHOT_MS = 780
const RESOLVE_MS = 1000
const MAKE_PROBABILITY = 0.55

interface Point {
  x: number
  y: number
}

interface Player {
  x: number
  y: number
  tx: number
  ty: number
  /** Easing rate, per second — jittered so the five never move in lockstep. */
  k: number
}

interface Flight {
  from: Point
  ctrl: Point
  to: Point
  start: number
  dur: number
  kind: 'pass' | 'shot' | 'rebound'
  /** pass: index of the receiving attacker. */
  target?: number
  make?: boolean
}

type Phase = 'advance' | 'settle' | 'possession' | 'flight' | 'resolve'

interface Game {
  /** 1: O attacks the right rim; -1: O attacks the left rim. */
  oAttacks: 1 | -1
  offenseIsO: boolean
  phase: Phase
  phaseUntil: number
  handler: number
  passesLeft: number
  cutter: number | null
  flight: Flight | null
  ball: Point
  /** Ring pulse at the rim after a make: birth timestamp, or 0. */
  pulseStart: number
  pulsePoint: Point
  o: Player[]
  x: Player[]
}

/** The ball is basketball orange — the brand hue, on decoration only. */
function ballColor(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-brand')
    .trim()
  return raw || '#e2682a'
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const jitter = (amount = 8) => (Math.random() - 0.5) * amount

/**
 * Half-court spot template, in court units: x is distance from the
 * attacked baseline as a share of half the court length, y is a share of
 * half the court width. Corners, wings, top — the same five spots the
 * static vignettes used.
 */
const SPOTS: Point[] = [
  { x: 0.1, y: -0.82 },
  { x: 0.42, y: -0.5 },
  { x: 0.56, y: 0 },
  { x: 0.42, y: 0.5 },
  { x: 0.1, y: 0.82 },
]

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
      // Court frame, computed in layout().
      cx: 0,
      cy: 0,
      halfW: 0, // half the court length
      halfH: 0, // half the court width
      game: null as Game | null,
      reducedMotion: false,
      rafId: 0,
      running: false,
      lastFrame: 0,
      ball: ballColor(),
    }

    const layout = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      state.width = w
      state.height = h
      canvas.width = Math.floor(w * state.dpr)
      canvas.height = Math.floor(h * state.dpr)
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
      // The court: most of the viewport width, seated LOW — the reading
      // band and the content cards own the upper two thirds of a viewport,
      // so a court centred there is a court nobody sees. Measured on the
      // real pages: at 0.58 the card stack hid the top half of the floor.
      state.halfW = Math.min(w * 0.44, 470)
      state.halfH = Math.min(state.halfW / 1.88, h * 0.26)
      state.cx = w / 2
      state.cy = h - state.halfH - Math.min(h * 0.06, 56)
      state.game = buildGame(performance.now())
    }

    /** Rim x for the end at direction d (1 = right, -1 = left). */
    const rimX = (d: 1 | -1) => state.cx + d * (state.halfW - state.halfH * 0.16)

    /** A spot from the template, attacking the rim at direction d. */
    const spotPoint = (spot: Point, d: 1 | -1): Point => ({
      x: rimX(d) - d * spot.x * state.halfW * 1.05,
      y: state.cy + spot.y * state.halfH,
    })

    const attackTargets = (d: 1 | -1): Point[] =>
      SPOTS.map((s) => ({ x: spotPoint(s, d).x + jitter(), y: spotPoint(s, d).y + jitter() }))

    /** Defenders sit between their man and the rim they protect. */
    const defenseTargets = (attackers: Player[], d: 1 | -1): Point[] => {
      const rx = rimX(d)
      return attackers.map((a) => ({
        x: a.tx + (rx - a.tx) * 0.34 + jitter(4),
        y: a.ty + (state.cy - a.ty) * 0.18 + jitter(4),
      }))
    }

    const makePlayers = (points: Point[]): Player[] =>
      points.map((p) => ({ x: p.x, y: p.y, tx: p.x, ty: p.y, k: rand(1.6, 2.6) }))

    /** A fresh game, mid-transition so it starts moving immediately. */
    function buildGame(now: number): Game {
      const oAttacks: 1 | -1 = Math.random() < 0.5 ? 1 : -1
      const o = makePlayers(attackTargets(oAttacks))
      const x = makePlayers(defenseTargets(o, oAttacks))
      // Scatter both teams toward the other half so the opening move is a
      // visible flow into position.
      for (const p of [...o, ...x]) {
        p.x = p.x - oAttacks * state.halfW * rand(0.4, 0.9)
        p.y = p.y + jitter(state.halfH)
      }
      const handler = 2
      const game: Game = {
        oAttacks,
        offenseIsO: true,
        phase: 'advance',
        phaseUntil: now + ADVANCE_MS,
        handler,
        passesLeft: 1 + Math.floor(Math.random() * 3),
        cutter: null,
        flight: null,
        ball: { x: o[handler].x, y: o[handler].y },
        pulseStart: 0,
        pulsePoint: { x: 0, y: 0 },
        o,
        x,
      }
      return game
    }

    const offense = (g: Game) => (g.offenseIsO ? g.o : g.x)
    const defense = (g: Game) => (g.offenseIsO ? g.x : g.o)
    const attackDir = (g: Game): 1 | -1 =>
      g.offenseIsO ? g.oAttacks : ((-g.oAttacks) as 1 | -1)

    /** Point a possession's spots and matchups at the current attacking end. */
    const setPossessionTargets = (g: Game) => {
      const d = attackDir(g)
      const spots = attackTargets(d)
      offense(g).forEach((p, i) => {
        p.tx = spots[i].x
        p.ty = spots[i].y
      })
      const def = defenseTargets(offense(g), d)
      defense(g).forEach((p, i) => {
        p.tx = def[i].x
        p.ty = def[i].y
      })
    }

    /** Flip possession and send everyone the other way. */
    const turnover = (g: Game, now: number) => {
      g.offenseIsO = !g.offenseIsO
      g.phase = 'advance'
      g.phaseUntil = now + ADVANCE_MS
      g.handler = 2
      g.passesLeft = 1 + Math.floor(Math.random() * 3)
      g.cutter = null
      setPossessionTargets(g)
      const h = offense(g)[g.handler]
      g.ball = { x: h.x, y: h.y }
    }

    const quad = (f: Flight, t: number): Point => {
      const u = 1 - t
      return {
        x: u * u * f.from.x + 2 * u * t * f.ctrl.x + t * t * f.to.x,
        y: u * u * f.from.y + 2 * u * t * f.ctrl.y + t * t * f.to.y,
      }
    }

    /** One simulation step. dt in seconds. */
    const step = (g: Game, now: number, dt: number) => {
      // Players ease toward their targets, never in lockstep.
      for (const p of [...g.o, ...g.x]) {
        const ease = 1 - Math.exp(-dt * p.k)
        p.x += (p.tx - p.x) * ease
        p.y += (p.ty - p.y) * ease
      }

      const att = offense(g)
      const d = attackDir(g)

      if (g.phase === 'advance' || g.phase === 'settle' || g.phase === 'possession') {
        // The ball rides the handler, with a small dribble waggle.
        const h = att[g.handler]
        g.ball.x = h.x + Math.sin(now / 130) * 2
        g.ball.y = h.y + 7 + Math.abs(Math.sin(now / 130)) * 4
      }

      if (g.phase === 'advance' && now >= g.phaseUntil) {
        g.phase = 'settle'
        g.phaseUntil = now + SETTLE_MS
        return
      }
      if (g.phase === 'settle' && now >= g.phaseUntil) {
        g.phase = 'possession'
        g.phaseUntil = now + DWELL_MIN + Math.random() * DWELL_RANGE
        return
      }

      if (g.phase === 'possession' && now >= g.phaseUntil) {
        // A cutter finishes their run back to the spot before anything else.
        if (g.cutter !== null) {
          const spots = attackTargets(d)
          att[g.cutter].tx = spots[g.cutter].x
          att[g.cutter].ty = spots[g.cutter].y
          g.cutter = null
        }
        const shoot = g.passesLeft <= 0 || Math.random() < 0.3
        const h = att[g.handler]
        if (shoot) {
          const rim: Point = { x: rimX(d), y: state.cy }
          g.flight = {
            from: { x: g.ball.x, y: g.ball.y },
            ctrl: {
              x: (g.ball.x + rim.x) / 2,
              y: Math.min(g.ball.y, rim.y) - state.halfH * rand(0.55, 0.8),
            },
            to: { x: rim.x, y: rim.y - 4 },
            start: now,
            dur: SHOT_MS,
            kind: 'shot',
            make: Math.random() < MAKE_PROBABILITY,
          }
          g.phase = 'flight'
        } else {
          let target = Math.floor(Math.random() * att.length)
          if (target === g.handler) target = (target + 1) % att.length
          const to = att[target]
          g.flight = {
            from: { x: g.ball.x, y: g.ball.y },
            ctrl: {
              x: (g.ball.x + to.x) / 2 + jitter(14),
              y: (g.ball.y + to.y) / 2 - rand(8, 26),
            },
            to: { x: to.x, y: to.y + 6 },
            start: now,
            dur: PASS_MS,
            kind: 'pass',
            target,
          }
          g.passesLeft -= 1
          g.phase = 'flight'
          // Sometimes the passer cuts through the lane after giving it up.
          if (Math.random() < 0.4 && g.cutter === null) {
            g.cutter = g.handler
            h.tx = rimX(d) - d * state.halfH * 0.2
            h.ty = state.cy + jitter(12)
          }
        }
        return
      }

      if (g.phase === 'flight' && g.flight) {
        const f = g.flight
        const t = Math.min((now - f.start) / f.dur, 1)
        const p = quad(f, t)
        g.ball.x = p.x
        g.ball.y = p.y
        if (t >= 1) {
          if (f.kind === 'pass' && f.target !== undefined) {
            g.handler = f.target
            g.flight = null
            g.phase = 'possession'
            g.phaseUntil = now + DWELL_MIN + Math.random() * DWELL_RANGE
            // The defense shades toward the new ball side.
            const def = defenseTargets(att, d)
            defense(g).forEach((pl, i) => {
              pl.tx = def[i].x
              pl.ty = def[i].y
            })
          } else if (f.kind === 'shot') {
            g.flight = null
            g.phase = 'resolve'
            g.phaseUntil = now + RESOLVE_MS
            if (f.make) {
              g.pulseStart = now
              g.pulsePoint = { x: rimX(d), y: state.cy }
              g.ball.y = state.cy + 14 // dropped through
            } else {
              // Off the rim to a board spot; the nearest defender collects.
              const board: Point = {
                x: rimX(d) - d * rand(18, 44),
                y: state.cy + jitter(40),
              }
              g.flight = {
                from: { x: g.ball.x, y: g.ball.y },
                ctrl: { x: (g.ball.x + board.x) / 2, y: state.cy - rand(16, 30) },
                to: board,
                start: now,
                dur: 340,
                kind: 'rebound',
              }
              g.phase = 'flight'
            }
          } else {
            // Rebound landed — turn and go the other way.
            g.flight = null
            turnover(g, now)
          }
        }
        return
      }

      if (g.phase === 'resolve' && now >= g.phaseUntil) {
        turnover(g, now)
      }
    }

    /* ------------------------------------------------------------ drawing */

    const chalk = (alpha: number) => `rgba(255,255,255,${alpha})`
    const amber = (alpha: number) => `rgba(${X_CHALK},${alpha})`

    const drawCourt = () => {
      const { cx, cy, halfW, halfH } = state
      ctx.lineWidth = 1
      ctx.strokeStyle = chalk(COURT_ALPHA)
      // The floor.
      ctx.strokeRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2)
      // Half-court line and centre circle.
      ctx.beginPath()
      ctx.moveTo(cx, cy - halfH)
      ctx.lineTo(cx, cy + halfH)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, halfH * 0.24, 0, Math.PI * 2)
      ctx.stroke()
      // Both ends: key, free-throw circle, arc, backboard, rim.
      for (const d of [1, -1] as const) {
        const rx = rimX(d)
        const keyLen = halfW * 0.24
        const keyWide = halfH * 0.5
        const baseX = cx + d * halfW
        ctx.strokeRect(
          Math.min(baseX, baseX - d * keyLen),
          cy - keyWide / 2,
          keyLen,
          keyWide,
        )
        ctx.beginPath()
        ctx.arc(
          baseX - d * keyLen,
          cy,
          keyWide * 0.42,
          d === 1 ? Math.PI / 2 : -Math.PI / 2,
          d === 1 ? (Math.PI * 3) / 2 : Math.PI / 2,
        )
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(
          rx,
          cy,
          halfH * 0.82,
          d === 1 ? Math.PI / 2 : -Math.PI / 2,
          d === 1 ? (Math.PI * 3) / 2 : Math.PI / 2,
        )
        ctx.stroke()
        // Backboard and rim.
        ctx.beginPath()
        ctx.moveTo(rx + d * 6, cy - 9)
        ctx.lineTo(rx + d * 6, cy + 9)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(rx, cy, 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const drawPlayers = (g: Game) => {
      ctx.lineWidth = 1.5
      ctx.strokeStyle = chalk(O_ALPHA)
      for (const p of g.o) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.strokeStyle = amber(X_ALPHA)
      for (const p of g.x) {
        ctx.beginPath()
        ctx.moveTo(p.x - 5, p.y - 5)
        ctx.lineTo(p.x + 5, p.y + 5)
        ctx.moveTo(p.x + 5, p.y - 5)
        ctx.lineTo(p.x - 5, p.y + 5)
        ctx.stroke()
      }
    }

    const drawBallAndPulse = (g: Game, now: number) => {
      ctx.save()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = state.ball
      ctx.globalAlpha = BALL_ALPHA
      ctx.beginPath()
      ctx.arc(g.ball.x, g.ball.y, 3.5, 0, Math.PI * 2)
      ctx.stroke()
      // The bucket: a ring blooming off the rim, plus the swish flicks.
      if (g.pulseStart > 0) {
        const t = (now - g.pulseStart) / 700
        if (t >= 1) {
          g.pulseStart = 0
        } else {
          ctx.globalAlpha = BALL_ALPHA * (1 - t)
          ctx.beginPath()
          ctx.arc(g.pulsePoint.x, g.pulsePoint.y, 4 + t * 12, 0, Math.PI * 2)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(g.pulsePoint.x - 3, g.pulsePoint.y + 6)
          ctx.lineTo(g.pulsePoint.x - 5, g.pulsePoint.y + 13)
          ctx.moveTo(g.pulsePoint.x + 3, g.pulsePoint.y + 6)
          ctx.lineTo(g.pulsePoint.x + 5, g.pulsePoint.y + 13)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    const drawFrame = (now: number) => {
      ctx.clearRect(0, 0, state.width, state.height)
      drawCourt()
      const g = state.game
      if (!g) return
      drawPlayers(g)
      drawBallAndPulse(g, now)
    }

    const loop = (now: number) => {
      state.rafId = requestAnimationFrame(loop)
      const dt = Math.min((now - state.lastFrame) / 1000, 0.1)
      if (now - state.lastFrame < FPS_INTERVAL) return
      state.lastFrame = now
      if (state.game) step(state.game, now, dt)
      drawFrame(now)
    }

    const start = () => {
      if (state.running || state.reducedMotion) return
      state.running = true
      state.lastFrame = performance.now()
      state.rafId = requestAnimationFrame(loop)
    }
    const stop = () => {
      state.running = false
      cancelAnimationFrame(state.rafId)
    }

    /** Reduced motion: one mid-possession frame, everyone at their spots. */
    const drawStill = () => {
      const g = buildGame(0)
      for (const p of [...g.o, ...g.x]) {
        p.x = p.tx
        p.y = p.ty
      }
      const h = (g.offenseIsO ? g.o : g.x)[g.handler]
      g.ball = { x: h.x, y: h.y + 8 }
      state.game = g
      drawFrame(0)
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
