/**
 * A tiny in-app navigation stack, so a back control can tell "the reader
 * navigated here from another page on this site" apart from "the reader
 * landed here cold".
 *
 * The browser cannot answer that question directly: `history.length` counts
 * pages from before this site, and `document.referrer` does not update on
 * client-side navigations. So the shell records each pathname it renders
 * into sessionStorage, and <BackLink> reads the depth.
 *
 * The one heuristic: when the new pathname equals the entry *under* the top
 * of the stack, it is treated as a back navigation and popped rather than
 * pushed. That undercounts A → B → A reached by links — and undercounting is
 * the safe direction, because a shallow stack makes <BackLink> fall back to
 * its contextual parent href, which is always a sensible destination.
 * Overcounting would `history.back()` a reader out of the site.
 */

const KEY = 'hardwood.navstack'
const MAX_DEPTH = 50

function read(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

function write(stack: string[]) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX_DEPTH)))
  } catch {
    // Storage unavailable (private mode quota, disabled) — BackLink simply
    // always uses its fallback href, which is correct behaviour.
  }
}

/** Record a rendered pathname. Called by the shell on every route change. */
export function recordVisit(pathname: string) {
  const stack = read()
  const top = stack[stack.length - 1]
  if (top === pathname) return
  if (stack[stack.length - 2] === pathname) {
    stack.pop()
  } else {
    stack.push(pathname)
  }
  write(stack)
}

/** Is there an in-app page behind this one to go back to? */
export function canGoBack(): boolean {
  return read().length > 1
}
