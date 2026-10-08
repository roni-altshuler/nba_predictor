/** @jest-environment node */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

type ReplayResult = {
  matchingMarkup: boolean
  pendingLog: string[]
  settledLog: string[]
  errors: { message: string }[]
  wrapperReused: boolean
  contentReused: boolean
}

function replay(args: string[] = []): ReplayResult {
  // Next's App Router bundles a different renderer from the package used by
  // ordinary component tests. Isolate its exact runtime and scheduler in Node.
  return JSON.parse(execFileSync(process.execPath, [resolve('scripts/qa/hydration_replay.cjs'), ...args], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8', timeout: 10000,
  }))
}

describe('PageTransition hydration', () => {
  it('keeps the server page when a streamed route child resolves during the hydration yield', () => {
    const result = replay()
    expect(result.matchingMarkup).toBe(true)
    expect(result.pendingLog).toEqual(['read:pending'])
    expect(result.settledLog).toEqual(['read:fulfilled'])
    expect(result.errors).toEqual([])
    expect(result.wrapperReused).toBe(true)
    expect(result.contentReused).toBe(true)
  })

  it('still reports a real mismatch in the server page content', () => {
    const result = replay(['--different-server-text'])
    expect(result.errors.some(error => error.message.includes('#418'))).toBe(true)
    expect(result.contentReused).toBe(false)
  })
})
