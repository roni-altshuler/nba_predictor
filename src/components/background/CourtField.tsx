'use client'

import { useEffect, useRef } from 'react'

/**
 * The chalk game: Hardwood's animated ambient layer.
 *
 * A fixed canvas at z-index -1 — behind every in-flow element, above the
 * body's walnut. It draws one full chalk court and, on it, a perpetual
 * dim five-on-five: the O team in white chalk, the X team in amber, the
 * ball in the brand orange. The playbook is real — drives and kick-outs,
 * catch-and-shoot swings, passing-lane steals, sprinting fast breaks —
 * so no two possessions read alike.
 *
 * Framing (owner-directed, 2026-08-25): **the whole court, both rims,
 * always in frame, centred in the viewport, on every device.** The
 * background must never make a reader look away from the data, so the
 * broadcast-style tracking camera of the first cut was demoted to a
 * breath: the virtual camera only leans a few percent toward the ball
 * (zoom ≤ ~1.05×, eased slowly), clamped so the full floor never leaves
 * view. Portrait viewports rotate the court upright so it fits the
 * device appropriately instead of shrinking to a sliver. The drama
 * lives in the play, not the framing.
 *
 * What keeps it a background and not a broadcast:
 * - **No digits, ever.** A score in the background is a number, and every
 *   number on this site is a claim. The bucket itself is the payoff.
 * - Chalk-dust alphas only (court ≤ 0.30, players ≤ 0.45, ball ≤ 0.60 —
 *   the ball's fading flight trail stays under the ball's own cap), and
 *   every surface that carries a number is opaque and paints over it.
 * - Rendering is capped near 30fps; `requestAnimationFrame` only runs
 *   while the tab is visible; reduced motion gets a single framed
 *   mid-possession still and no motion at all.
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

// Pace, ms. A half-court possession is advance + settle + swings + shot;
// a fast break compresses all of it.
const ADVANCE_MS = 2200
const ADVANCE_FAST_MS = 1250
const SETTLE_MS = 850
const SETTLE_FAST_MS = 420
const DWELL_MIN = 550
const DWELL_RANGE = 550
const CATCH_SHOOT_MS = 300
const PASS_MS = 400
const SHOT_MS = 760
const LAYUP_MS = 470
const DRIVE_MS_MAX = 1100
const RESOLVE_MS = 950
const TRAIL_MS = 420
const STEAL_CHANCE = 0.08
const FASTBREAK_AFTER_BOARD = 0.4

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
  /** shot: a drive finish — short, low arc. */
  layup?: boolean
  /** pass: a defender jumps the lane and the flight ends at the pick. */
  steal?: boolean
}

type Phase = 'advance' | 'settle' | 'possession' | 'drive' | 'flight' | 'resolve'

interface TrailPoint extends Point {
  t: number
}

interface Game {
  /** 1: O attacks the right rim; -1: O attacks the left rim. */
  oAttacks: 1 | -1
  offenseIsO: boolean
  /** A fast break: sprint speeds, compressed clocks, wide camera. */
  fast: boolean
  phase: Phase
  phaseUntil: number
  handler: number
  passesLeft: number
  cutter: number | null
  /** After a kick-out: the catcher rises almost immediately. */
  pendingCatchShoot: boolean
  flight: Flight | null
  ball: Point
  trail: TrailPoint[]
  /** Ring pulse at the rim after a make: birth timestamp, or 0. */
  pulseStart: number
  pulsePoint: Point
  o: Player[]
  x: Player[]
}

/** The broadcast camera: position + zoom, both eased toward targets. */
interface Camera {
  x: number
  y: number
  z: number
  tx: number
  ty: number
  tz: number
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
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const nearestIndex = (players: Player[], p: Point): number => {
  let best = 0
  let bestD = Infinity
  players.forEach((pl, i) => {
    const d = dist(pl, p)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

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

/** Perimeter spots a drive can kick out to — wings and the top. */
const KICKOUT_SPOTS = [1, 2, 3]

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
      // Court frame in WORLD coordinates, centred on the origin.
      halfW: 0, // half the court length
      halfH: 0, // half the court width
      // Portrait viewports draw the court rotated 90° so it uses the
      // device's long axis instead of shrinking to fit the short one.
      portrait: false,
      // Where the camera's eye lands on the screen — the centre of the
      // viewport (owner-directed: the court is centred, whole, always).
      viewCx: 0,
      viewCy: 0,
      cam: { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1 } as Camera,
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
      // The whole floor fits with margin to spare — even at the camera's
      // maximum lean (~1.05× zoom plus a small offset) both rims stay
      // inside the viewport. Portrait devices get the court upright.
      // The desktop sidebar is opaque and fixed, so "centred" means
      // centred in the region beside it — a viewport-centred court hides
      // its left rim behind the nav (measured on /accuracy).
      const sidebarW = window.matchMedia('(min-width: 768px)').matches
        ? parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              '--shell-sidebar-w',
            ),
          ) || 0
        : 0
      const availW = w - sidebarW
      state.portrait = h > w
      if (state.portrait) {
        state.halfW = Math.min(h * 0.34, 620)
        state.halfH = Math.min(state.halfW / 1.88, availW * 0.42)
      } else {
        state.halfW = Math.min(availW * 0.44, 620)
        state.halfH = Math.min(state.halfW / 1.88, h * 0.3)
      }
      state.viewCx = sidebarW + availW / 2
      state.viewCy = h * 0.55
      state.game = buildGame(performance.now())
      snapCamera(state.game)
    }

    /** Rim x for the end at direction d (1 = right, -1 = left). */
    const rimX = (d: 1 | -1) => d * (state.halfW - state.halfH * 0.16)

    /** A spot from the template, attacking the rim at direction d. */
    const spotPoint = (spot: Point, d: 1 | -1): Point => ({
      x: rimX(d) - d * spot.x * state.halfW * 1.05,
      y: spot.y * state.halfH,
    })

    const attackTargets = (d: 1 | -1): Point[] =>
      SPOTS.map((s) => ({ x: spotPoint(s, d).x + jitter(), y: spotPoint(s, d).y + jitter() }))

    /** Defenders sit between their man and the rim they protect. */
    const defenseTargets = (attackers: Player[], d: 1 | -1): Point[] => {
      const rx = rimX(d)
      return attackers.map((a) => ({
        x: a.tx + (rx - a.tx) * 0.34 + jitter(4),
        y: a.ty + (0 - a.ty) * 0.18 + jitter(4),
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
        fast: false,
        phase: 'advance',
        phaseUntil: now + ADVANCE_MS,
        handler,
        passesLeft: 1 + Math.floor(Math.random() * 3),
        cutter: null,
        pendingCatchShoot: false,
        flight: null,
        ball: { x: o[handler].x, y: o[handler].y },
        trail: [],
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

    /**
     * Flip possession and send everyone the other way. `fast` compresses
     * the clocks and puts everyone in a sprint; `at` is where the ball
     * changed hands, so the nearest new attacker picks it up rather than
     * the ball teleporting to a designated handler.
     */
    const turnover = (g: Game, now: number, fast = false, at?: Point) => {
      g.offenseIsO = !g.offenseIsO
      g.fast = fast
      g.phase = 'advance'
      g.phaseUntil = now + (fast ? ADVANCE_FAST_MS : ADVANCE_MS)
      g.passesLeft = fast
        ? Math.floor(Math.random() * 2)
        : 1 + Math.floor(Math.random() * 3)
      g.cutter = null
      g.pendingCatchShoot = false
      setPossessionTargets(g)
      const att = offense(g)
      g.handler = nearestIndex(att, at ?? g.ball)
      for (const p of [...g.o, ...g.x]) {
        p.k = fast ? rand(2.6, 3.9) : rand(1.6, 2.6)
      }
      g.ball = { x: att[g.handler].x, y: att[g.handler].y }
    }

    const quad = (f: Flight, t: number): Point => {
      const u = 1 - t
      return {
        x: u * u * f.from.x + 2 * u * t * f.ctrl.x + t * t * f.to.x,
        y: u * u * f.from.y + 2 * u * t * f.ctrl.y + t * t * f.to.y,
      }
    }

    /** Launch a shot from wherever the ball is. Distance sets the odds. */
    const launchShot = (g: Game, now: number, layup: boolean) => {
      const d = attackDir(g)
      const rim: Point = { x: rimX(d), y: 0 }
      const far = dist(g.ball, rim) > state.halfH * 1.1
      g.flight = {
        from: { x: g.ball.x, y: g.ball.y },
        ctrl: {
          x: (g.ball.x + rim.x) / 2,
          y:
            Math.min(g.ball.y, rim.y) -
            state.halfH * (layup ? rand(0.22, 0.34) : rand(0.55, 0.8)),
        },
        to: { x: rim.x, y: rim.y - 4 },
        start: now,
        dur: layup ? LAYUP_MS : SHOT_MS,
        kind: 'shot',
        layup,
        make: Math.random() < (layup ? 0.62 : far ? 0.44 : 0.52),
      }
      g.phase = 'flight'
    }

    /** Throw a pass; sometimes a defender reads it and jumps the lane. */
    const launchPass = (g: Game, now: number, target: number) => {
      const att = offense(g)
      const to = att[target]
      const flight: Flight = {
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
      if (Math.random() < STEAL_CHANCE) {
        // The receiver's defender jumps the lane: the flight ends at the
        // pick point and possession flips into a sprint the other way.
        const pick = quad(flight, 0.62)
        flight.to = pick
        flight.dur = Math.round(flight.dur * 0.62)
        flight.steal = true
        const thief = defense(g)[target]
        thief.tx = pick.x
        thief.ty = pick.y
        thief.k = 3.4
      }
      g.flight = flight
      g.passesLeft -= 1
      g.phase = 'flight'
    }

    /** One simulation step. dt in seconds. */
    const step = (g: Game, now: number, dt: number) => {
      // Players ease toward their targets, never in lockstep.
      for (const p of [...g.o, ...g.x]) {
        const ease = 1 - Math.exp(-dt * p.k)
        p.x += (p.tx - p.x) * ease
        p.y += (p.ty - p.y) * ease
      }

      // The ball leaves chalk while it flies.
      g.trail = g.trail.filter((p) => now - p.t < TRAIL_MS)
      if (g.flight) g.trail.push({ x: g.ball.x, y: g.ball.y, t: now })

      const att = offense(g)
      const d = attackDir(g)
      const rim: Point = { x: rimX(d), y: 0 }

      if (
        g.phase === 'advance' ||
        g.phase === 'settle' ||
        g.phase === 'possession' ||
        g.phase === 'drive'
      ) {
        // The ball rides the handler, with a small dribble waggle.
        const h = att[g.handler]
        g.ball.x = h.x + Math.sin(now / 130) * 2
        g.ball.y = h.y + 7 + Math.abs(Math.sin(now / 130)) * 4
      }

      if (g.phase === 'advance' && now >= g.phaseUntil) {
        g.phase = 'settle'
        g.phaseUntil = now + (g.fast ? SETTLE_FAST_MS : SETTLE_MS)
        return
      }
      if (g.phase === 'settle' && now >= g.phaseUntil) {
        g.phase = 'possession'
        g.phaseUntil = now + DWELL_MIN + Math.random() * DWELL_RANGE
        return
      }

      if (g.phase === 'drive') {
        // The driver's man slides with him, shading toward the rim.
        const h = att[g.handler]
        const guard = defense(g)[g.handler]
        guard.tx = h.x + (rim.x - h.x) * 0.5
        guard.ty = h.y + (rim.y - h.y) * 0.5
        if (dist(h, rim) < state.halfH * 0.38 || now >= g.phaseUntil) {
          h.k = rand(1.6, 2.6)
          if (Math.random() < 0.28) {
            // Kick-out: fire it back to the perimeter for a quick rise.
            const options = KICKOUT_SPOTS.filter((i) => i !== g.handler)
            const target = options[Math.floor(Math.random() * options.length)]
            g.pendingCatchShoot = true
            // The driver clears out to a corner behind the play.
            const corner = spotPoint(SPOTS[h.y < 0 ? 0 : 4], d)
            h.tx = corner.x
            h.ty = corner.y
            launchPass(g, now, target)
          } else {
            launchShot(g, now, true)
          }
        }
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
        const h = att[g.handler]
        if (g.pendingCatchShoot) {
          g.pendingCatchShoot = false
          launchShot(g, now, false)
          return
        }
        const roll = Math.random()
        const mustShoot = g.passesLeft <= 0
        if (mustShoot || roll < 0.28) {
          launchShot(g, now, false)
        } else if (roll < 0.5 && dist(h, rim) > state.halfH * 0.9) {
          // Put it on the floor: a burst to the rim, defender in tow.
          g.phase = 'drive'
          g.phaseUntil = now + DRIVE_MS_MAX
          h.k = 3.2
          h.tx = rim.x - d * state.halfH * 0.3
          h.ty = jitter(14)
        } else {
          let target = Math.floor(Math.random() * att.length)
          if (target === g.handler) target = (target + 1) % att.length
          launchPass(g, now, target)
          // Sometimes the passer cuts through the lane after giving it up.
          if (Math.random() < 0.4 && g.cutter === null) {
            g.cutter = g.handler
            h.tx = rim.x - d * state.halfH * 0.2
            h.ty = jitter(12)
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
          if (f.kind === 'pass' && f.steal) {
            g.flight = null
            turnover(g, now, true, f.to)
          } else if (f.kind === 'pass' && f.target !== undefined) {
            g.handler = f.target
            g.flight = null
            g.phase = 'possession'
            g.phaseUntil =
              now +
              (g.pendingCatchShoot
                ? CATCH_SHOOT_MS
                : DWELL_MIN + Math.random() * DWELL_RANGE)
            // The defense shades toward the new ball side.
            const def = defenseTargets(att, d)
            defense(g).forEach((pl, i) => {
              pl.tx = def[i].x
              pl.ty = def[i].y
            })
          } else if (f.kind === 'shot') {
            g.flight = null
            if (f.make) {
              g.phase = 'resolve'
              g.phaseUntil = now + RESOLVE_MS
              g.pulseStart = now
              g.pulsePoint = { x: rim.x, y: rim.y }
              g.ball.y = rim.y + 14 // dropped through
            } else {
              // Off the rim to a board spot; the nearest defender collects.
              const board: Point = {
                x: rim.x - d * rand(18, 44),
                y: jitter(40),
              }
              g.flight = {
                from: { x: g.ball.x, y: g.ball.y },
                ctrl: { x: (g.ball.x + board.x) / 2, y: rim.y - rand(16, 30) },
                to: board,
                start: now,
                dur: 340,
                kind: 'rebound',
              }
              g.phase = 'flight'
            }
          } else {
            // Rebound landed — turn and go the other way, sometimes at a dead run.
            g.flight = null
            turnover(g, now, Math.random() < FASTBREAK_AFTER_BOARD)
          }
        }
        return
      }

      if (g.phase === 'resolve' && now >= g.phaseUntil) {
        turnover(g, now)
      }
    }

    /* ------------------------------------------------------------- camera */

    const snapCamera = (g: Game) => {
      updateCameraTargets(g)
      state.cam.x = state.cam.tx
      state.cam.y = state.cam.ty
      state.cam.z = state.cam.tz
    }

    /**
     * Where the camera wants to be, given what the game is doing. This
     * is deliberately a breath, not a broadcast: the lean toward the
     * ball and the zoom are both clamped so tightly that the whole
     * court — both rims — never leaves the viewport. The reader must
     * never be pulled away from the data by the background moving.
     */
    const updateCameraTargets = (g: Game) => {
      const cam = state.cam
      let tz = 1
      switch (g.phase) {
        case 'possession':
          tz = 1.02
          break
        case 'drive':
          tz = 1.04
          break
        case 'flight':
          tz = g.flight?.kind === 'shot' ? 1.045 : 1.02
          break
        case 'resolve':
          tz = 1.05
          break
        default:
          tz = 1
      }
      cam.tx = Math.max(
        -state.halfW * 0.05,
        Math.min(state.halfW * 0.05, g.ball.x * 0.06),
      )
      cam.ty = Math.max(
        -state.halfH * 0.08,
        Math.min(state.halfH * 0.08, g.ball.y * 0.06),
      )
      cam.tz = tz
    }

    /** Ease toward the targets slowly — a breath, never a cut. */
    const stepCamera = (g: Game, dt: number) => {
      updateCameraTargets(g)
      const cam = state.cam
      const kPos = 1.0
      const kZoom = cam.tz < cam.z ? 1.3 : 0.8
      const easeP = 1 - Math.exp(-dt * kPos)
      const easeZ = 1 - Math.exp(-dt * kZoom)
      cam.x += (cam.tx - cam.x) * easeP
      cam.y += (cam.ty - cam.y) * easeP
      cam.z += (cam.tz - cam.z) * easeZ
    }

    /* ------------------------------------------------------------ drawing */

    const chalk = (alpha: number) => `rgba(255,255,255,${alpha})`
    const amber = (alpha: number) => `rgba(${X_CHALK},${alpha})`

    const drawCourt = () => {
      const { halfW, halfH } = state
      ctx.lineWidth = 1
      ctx.strokeStyle = chalk(COURT_ALPHA)
      // The floor.
      ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2)
      // Half-court line and centre circle.
      ctx.beginPath()
      ctx.moveTo(0, -halfH)
      ctx.lineTo(0, halfH)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, halfH * 0.24, 0, Math.PI * 2)
      ctx.stroke()
      // Both ends: key, free-throw circle, arc, backboard, rim.
      for (const d of [1, -1] as const) {
        const rx = rimX(d)
        const keyLen = halfW * 0.24
        const keyWide = halfH * 0.5
        const baseX = d * halfW
        ctx.strokeRect(
          Math.min(baseX, baseX - d * keyLen),
          -keyWide / 2,
          keyLen,
          keyWide,
        )
        ctx.beginPath()
        ctx.arc(
          baseX - d * keyLen,
          0,
          keyWide * 0.42,
          d === 1 ? Math.PI / 2 : -Math.PI / 2,
          d === 1 ? (Math.PI * 3) / 2 : Math.PI / 2,
        )
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(
          rx,
          0,
          halfH * 0.82,
          d === 1 ? Math.PI / 2 : -Math.PI / 2,
          d === 1 ? (Math.PI * 3) / 2 : Math.PI / 2,
        )
        ctx.stroke()
        // Backboard and rim.
        ctx.beginPath()
        ctx.moveTo(rx + d * 6, -9)
        ctx.lineTo(rx + d * 6, 9)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(rx, 0, 4, 0, Math.PI * 2)
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

    /** Chalk dust behind a flying ball, fading inside half a second. */
    const drawTrail = (g: Game, now: number) => {
      if (g.trail.length < 2) return
      ctx.save()
      ctx.strokeStyle = state.ball
      ctx.lineWidth = 1.6
      for (let i = 1; i < g.trail.length; i++) {
        const a = g.trail[i - 1]
        const b = g.trail[i]
        const age = now - b.t
        if (age > TRAIL_MS) continue
        ctx.globalAlpha = BALL_ALPHA * 0.5 * (1 - age / TRAIL_MS)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawBallAndPulse = (g: Game, now: number) => {
      ctx.save()
      ctx.lineWidth = 1.75
      ctx.strokeStyle = state.ball
      ctx.globalAlpha = BALL_ALPHA
      ctx.beginPath()
      ctx.arc(g.ball.x, g.ball.y, 4.5, 0, Math.PI * 2)
      ctx.stroke()
      // The bucket: a ring blooming off the rim, plus the swish flicks.
      if (g.pulseStart > 0) {
        const t = (now - g.pulseStart) / 700
        if (t >= 1) {
          g.pulseStart = 0
        } else {
          ctx.globalAlpha = BALL_ALPHA * (1 - t)
          ctx.beginPath()
          ctx.arc(g.pulsePoint.x, g.pulsePoint.y, 4 + t * 16, 0, Math.PI * 2)
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
      const g = state.game
      if (!g) return
      const cam = state.cam
      ctx.save()
      ctx.translate(state.viewCx, state.viewCy)
      ctx.scale(cam.z, cam.z)
      // Portrait: the court stands upright along the device's long axis.
      if (state.portrait) ctx.rotate(Math.PI / 2)
      ctx.translate(-cam.x, -cam.y)
      drawCourt()
      drawPlayers(g)
      drawTrail(g, now)
      drawBallAndPulse(g, now)
      ctx.restore()
    }

    const loop = (now: number) => {
      state.rafId = requestAnimationFrame(loop)
      const dt = Math.min((now - state.lastFrame) / 1000, 0.1)
      if (now - state.lastFrame < FPS_INTERVAL) return
      state.lastFrame = now
      if (state.game) {
        step(state.game, now, dt)
        stepCamera(state.game, dt)
      }
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

    /** Reduced motion: one framed mid-possession still, no motion at all. */
    const drawStill = () => {
      const g = buildGame(0)
      for (const p of [...g.o, ...g.x]) {
        p.x = p.tx
        p.y = p.ty
      }
      const h = (g.offenseIsO ? g.o : g.x)[g.handler]
      g.ball = { x: h.x, y: h.y + 8 }
      g.phase = 'possession'
      state.game = g
      snapCamera(g)
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
