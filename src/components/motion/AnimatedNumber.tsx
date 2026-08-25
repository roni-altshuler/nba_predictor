'use client'

import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'

import { EASE_OUT } from '@/lib/motion'

/**
 * A number that counts to its value when it changes.
 *
 * The motion value is written straight to `textContent`, so an update does
 * not re-render React. The server markup contains the FINAL value — a
 * crawler, a reader without JS and a reduced-motion reader all see the real
 * number, never 0 counting up.
 *
 * Always render this in a tabular-numeric font (`.numeric` / `font-numeric`)
 * so the layout does not jitter as digits change.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number
  /** Formats the in-flight value. Defaults to rounding. Keep it stable. */
  format?: (v: number) => string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef(value)
  const reduced = useReducedMotion()

  const fmt = useRef(format ?? ((v: number) => String(Math.round(v))))
  fmt.current = format ?? ((v: number) => String(Math.round(v)))

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const from = previous.current
    previous.current = value
    if (reduced || from === value) {
      node.textContent = fmt.current(value)
      return
    }
    const controls = animate(from, value, {
      duration: 0.6,
      ease: EASE_OUT,
      onUpdate: (v) => {
        node.textContent = fmt.current(v)
      },
    })
    return () => controls.stop()
  }, [value, reduced])

  return (
    <span ref={ref} className={className}>
      {fmt.current(value)}
    </span>
  )
}
