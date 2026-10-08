'use client'

import { useId, useSyncExternalStore } from 'react'

import { cn } from '@/lib/utils'

/**
 * The reader's dial on the ambient court: soft · vivid · off.
 *
 * Owner feedback (2026-09-12): the chalk game was "a little too sharp" to
 * read past. The in-canvas budgets were cut for everyone, and this hands
 * the rest of the decision to the reader. Three states, one attribute:
 *
 * - `soft` (default) — the canvas dimmed and slightly blurred, the floor's
 *   embers at 0.6×. What a first-time visitor sees.
 * - `vivid` — the full look, at the reduced in-canvas alphas.
 * - `off` — both halves hidden, and `CourtField` stops its rAF loop.
 *
 * The value lives in three places that must agree: `localStorage` under
 * `hardwood-ambient` (so it survives a reload), `data-ambient` on `<html>`
 * (what the CSS keys off), and an `ambientchange` event (what the canvas
 * listens for). The root layout's inline script reads storage BEFORE first
 * paint so a returning reader never sees the court flash vivid then dim.
 *
 * Segmented buttons rather than a select: three states fit on one row, and
 * `aria-pressed` tells a screen reader which one is on. The tap targets are
 * 44px on a phone, where this sits in the More sheet.
 */
export type Ambient = 'soft' | 'vivid' | 'off'

export const AMBIENT_KEY = 'hardwood-ambient'
export const AMBIENT_OPTIONS: readonly Ambient[] = ['soft', 'vivid', 'off']

/** Anything that is not a known state is `soft` — the calm default. */
export function parseAmbient(value: unknown): Ambient {
  return value === 'vivid' || value === 'off' ? value : 'soft'
}

function readAmbient(): Ambient {
  return parseAmbient(document.documentElement.dataset.ambient)
}

/** Set the state everywhere it lives, then tell the canvas. */
export function applyAmbient(value: Ambient) {
  document.documentElement.dataset.ambient = value
  try {
    localStorage.setItem(AMBIENT_KEY, value)
  } catch {
    // Storage blocked (private mode, quota): the attribute still applies
    // for this page, the choice simply does not survive a reload.
  }
  window.dispatchEvent(new CustomEvent<Ambient>('ambientchange', { detail: value }))
}

function subscribe(onChange: () => void) {
  window.addEventListener('ambientchange', onChange)
  // A document recreated during hydration recovery can lose the attribute
  // written by the pre-paint script. Restore the saved choice before the
  // dial/canvas settle on the default, without changing storage.
  if (!document.documentElement.hasAttribute('data-ambient')) {
    let value: Ambient = 'soft'
    try { value = parseAmbient(localStorage.getItem(AMBIENT_KEY)) } catch { /* Storage may be blocked. */ }
    document.documentElement.dataset.ambient = value
    window.dispatchEvent(new CustomEvent<Ambient>('ambientchange', { detail: value }))
  }
  return () => window.removeEventListener('ambientchange', onChange)
}

// The server cannot know storage. Defer the pressed announcement until the
// attribute can be read; CSS already paints that pre-paint choice correctly.
const serverSnapshot = (): Ambient | null => null

export function AmbientToggle({ className }: { className?: string }) {
  // The attribute is the store. Its CSS highlight is correct before hydration,
  // including returning readers whose preference is off or vivid.
  const value = useSyncExternalStore(subscribe, readAmbient, serverSnapshot)
  const labelId = useId()

  return (
    <div className={className}>
      <p id={labelId} className="eyebrow">
        Court
      </p>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-busy={value === null}
        className="mt-1.5 flex border border-[var(--border-color)]"
      >
        {AMBIENT_OPTIONS.map((option, index) => (
          <button
            key={option}
            type="button"
            data-ambient-option={option}
            aria-pressed={value === option}
            onClick={() => applyAmbient(option)}
            className={cn(
              'ambient-option flex min-h-[44px] flex-1 items-center justify-center px-2 text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] md:min-h-[30px]',
              index > 0 && 'border-l border-[var(--border-color)]',
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
