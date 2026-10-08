// Capture errors without suppressing them or retrying a failing navigation.
import { appendFile, mkdir, writeFile } from 'node:fs/promises'

export async function browserDiagnostics(page, out, id, { trace = true, controlledScoreboard = false } = {}) {
  await mkdir(out, { recursive: true })
  const started = Date.now(), events = [], documents = [], traces = [], pending = []
  let stage = 'initial', controlledFailure = false, sequence = 0
  const emit = event => {
    const row = { sequence: ++sequence, at: new Date().toISOString(), elapsedMs: Date.now() - started, id, stage, route: page.url(), ...event }
    events.push(row)
    pending.push(appendFile(`${out}/${id}-events.ndjson`, JSON.stringify(row) + '\n'))
    return row
  }
  if (trace) await page.addInitScript(() => {
    const trace = window.__qaHydrationTrace = { timeOrigin: performance.timeOrigin, mutations: [], errors: [], frames: [] }
    const describe = node => node.nodeType === 1 ? { tag: node.tagName, name: node.getAttribute('name'), property: node.getAttribute('property'), rel: node.getAttribute('rel'), src: node.getAttribute('src'), href: node.getAttribute('href'), text: node.tagName === 'TITLE' ? node.textContent : undefined, inlineScriptStart: node.tagName === 'SCRIPT' && !node.getAttribute('src') ? node.textContent.slice(0, 120) : undefined, textLength: node.tagName === 'SCRIPT' ? node.textContent.length : undefined } : { nodeType: node.nodeType }
    new MutationObserver(records => {
      for (const record of records) {
        if (trace.mutations.length >= 600) break
        if (record.type === 'attributes' && record.target === document.documentElement || record.type === 'childList' && ['HEAD', 'HTML'].includes(record.target.nodeName)) {
          trace.mutations.push({ ms: performance.now(), type: record.type, target: record.target.nodeName, attribute: record.attributeName, oldValue: record.oldValue, newValue: record.attributeName ? record.target.getAttribute(record.attributeName) : undefined, added: [...record.addedNodes].map(describe), removed: [...record.removedNodes].map(describe) })
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-ambient', 'class'] })
    window.addEventListener('error', event => trace.errors.push({ ms: performance.now(), message: event.message, stack: event.error?.stack ?? null, filename: event.filename, line: event.lineno, column: event.colno, route: location.href }))
    window.addEventListener('unhandledrejection', event => trace.errors.push({ ms: performance.now(), message: String(event.reason), stack: event.reason?.stack ?? null, route: location.href }))
    const sample = () => {
      if (document.body) trace.frames.push({ ms: performance.now(), ambient: document.documentElement.dataset.ambient ?? null, background: getComputedStyle(document.body).backgroundColor })
      if (trace.frames.length < 120) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  page.on('pageerror', error => {
    const row = emit({ type: 'pageerror', classification: 'unexpected', name: error.name, message: error.message, stack: error.stack ?? null })
    pending.push(page.evaluate(() => ({ title: document.title, root: document.documentElement.outerHTML.slice(0, 300), head: document.head.innerHTML, storedAmbient: localStorage.getItem('hardwood-ambient'), trace: window.__qaHydrationTrace })).then(state => writeFile(`${out}/${id}-error-${row.sequence}.json`, JSON.stringify({ ...row, state }, null, 2))).catch(error => writeFile(`${out}/${id}-error-${row.sequence}.json`, JSON.stringify({ ...row, captureError: error.message }, null, 2))))
  })
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return
    const text = message.text(), location = message.location()
    const logo = location.url.includes('espncdn.com') && /Failed to load resource/.test(text)
    const scoreboard = controlledScoreboard && /^https:\/\/site\.web\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\/nba\/scoreboard/.test(location.url) && /Failed to load resource.*\b503\b/.test(text)
    const expected = controlledFailure && /Server Components render|Controlled theme QA failure|Failed to load resource/.test(text) && !/#418|hydration/i.test(text)
    const row = emit({ type: 'console', level: message.type(), classification: logo ? 'controlled-logo-outage' : scoreboard ? 'controlled-scoreboard-503' : expected ? 'controlled-server-failure' : 'unexpected', message: text, location })
    if (!logo) pending.push(Promise.all(message.args().map(arg => arg.evaluate(value => value instanceof Error ? { message: value.message, stack: value.stack } : String(value)).catch(() => 'unavailable handle'))).then(args => { row.args = args }))
  })
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) emit({ type: 'navigation', url: frame.url() }) })
  page.on('response', response => {
    if (response.request().resourceType() !== 'document') return
    const n = documents.length + 1, document = { url: response.url(), status: response.status(), file: `${id}-document-${n}.html` }
    documents.push(document)
    pending.push(response.text().then(html => writeFile(`${out}/${document.file}`, html)).catch(error => { document.captureError = error.message }))
  })
  return {
    mark(value, allowControlledFailure = false) { stage = value; controlledFailure = allowControlledFailure; emit({ type: 'stage' }) },
    async checkpoint(value) {
      const state = await page.evaluate(() => ({ route: location.pathname + location.search + location.hash, title: document.title, ambient: document.documentElement.dataset.ambient ?? null, storedAmbient: localStorage.getItem('hardwood-ambient'), trace: window.__qaHydrationTrace }))
      traces.push({ stage: value, at: new Date().toISOString(), ...state })
      return state
    },
    async finish() {
      await Promise.allSettled(pending)
      const result = { id, startedAt: new Date(started).toISOString(), events, documents, traces, unexpected: events.filter(event => ['pageerror', 'console'].includes(event.type) && event.classification === 'unexpected') }
      await writeFile(`${out}/${id}-diagnostics.json`, JSON.stringify(result, null, 2) + '\n')
      return result
    },
  }
}
