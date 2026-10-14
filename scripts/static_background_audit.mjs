// Actual production pages, normal motion, both OS color preferences; no provider fetches.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { browserDiagnostics } from './qa/browser_diagnostics.mjs'
import { installMotionProbe, motionState } from './qa/motion_probe.mjs'

const base = process.env.QA_BASE || 'http://127.0.0.1:3221'
const out = process.env.QA_OUT || '/tmp/nba-static-background-2026-10-12/product'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { at: new Date().toISOString(), chromium: browser.version(), baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), normalMotion: true, journeys: [] }
const collectors = []
async function scan(page, journey, label, capture = false) {
  page.qaDiagnostics.mark(label)
  await page.waitForLoadState('networkidle')
  // Let intentional entry/number/menu feedback finish, then observe a fresh idle window.
  await page.waitForTimeout(1500)
  const before = await page.evaluate(motionState)
  await page.waitForTimeout(1200)
  const after = await page.evaluate(motionState)
  const delta = { requested: after.requested - before.requested, executed: after.executed - before.executed, draws: after.draws - before.draws }
  assert.deepEqual(delta, { requested: 0, executed: 0, draws: 0 }, `${label}: idle runtime`)
  assert.equal(after.pending, 0); assert.equal(after.canvases, 0); assert.equal(after.ambientNodes, 0)
  assert.equal(after.ambientAttribute, null); assert.equal(after.svgLoops, 0); assert.deepEqual(after.animations, [])
  assert.equal(after.background, 'rgb(12, 7, 5)'); assert.equal(after.backgroundImage, 'none')
  assert.equal(after.storage, journey.legacyPreference)
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const accessibility = await page.evaluate(async () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    violations: (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
  }))
  assert.equal(accessibility.overflow, false); assert.deepEqual(accessibility.violations, [])
  journey.states.push({ label, route: new URL(page.url()).pathname + new URL(page.url()).search, idleWindowMs: 1200, delta, runtime: after, ...accessibility })
  await page.qaDiagnostics.checkpoint(label)
  if (capture) await page.screenshot({ path: `${out}/${label}-${journey.width}-${journey.system}.png` })
  await writeFile(`${out}/partial.json`, JSON.stringify(report, null, 2))
}
async function visit(page, route) {
  await page.goto(base + route)
  const headings = { '/': 'NBA games & scores', '/teams/BOS': 'Boston Celtics',
    '/games': 'Games, one night at a time.', '/games/401909088': 'Boston Celtics at Detroit Pistons',
    '/games/401859967': 'Scoring by period', '/players/espn/900000001': 'Player profile unavailable',
    '/bracket': 'The road to the title', '/predict': 'Any two teams', '/accuracy': 'How right has it been',
    '/seasons/2026': '2025-26 season' }
  await page.getByRole('heading', { name: headings[new URL(route, base).pathname], exact: true }).waitFor()
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === location.pathname)
}

async function auditMoreMenu(page, journey) {
  const more = page.getByRole('button', { name: 'More', exact: true })
  const dialog = page.getByRole('dialog', { name: 'More pages', exact: true })
  journey.mobileMenu = []
  const focused = async (locator, label) => {
    assert.equal(await locator.evaluate(e => e === document.activeElement), true, label)
  }
  for (const key of ['Enter', 'Space']) {
    const trigger = await more.elementHandle()
    const restored = async label => {
      assert.equal(await trigger.evaluate(e => e.isConnected && e === document.activeElement), true, label)
      assert.equal(await more.getAttribute('aria-expanded'), 'false')
      await dialog.waitFor({ state: 'hidden' })
    }
    await more.focus(); await page.keyboard.press(key); await dialog.waitFor()
    await focused(dialog, `${key}: opening focuses sheet`)
    await page.keyboard.press('Tab')
    await focused(dialog.getByRole('link', { name: 'Season preview', exact: true }), `${key}: first Tab`)
    await page.keyboard.press('Tab')
    await focused(dialog.getByRole('link', { name: 'Games', exact: true }), `${key}: second Tab`)
    await page.screenshot({ path: `${out}/menu-open-${journey.width}-${journey.system}-${journey.reducedMotion || 'no-preference'}-${key}.png` })
    await page.keyboard.press('Escape'); await restored(`${key}: Escape returns actual trigger`)
    // Reopen immediately: an outgoing animation must not steal focus later.
    await page.keyboard.press(key); await dialog.waitFor()
    await focused(dialog, `${key}: immediate reopening`)
    await page.getByRole('button', { name: 'Close menu', exact: true }).click({ position: { x: 5, y: 5 } })
    await restored(`${key}: backdrop returns actual trigger`)
    await page.keyboard.press(key); await dialog.waitFor()
    await focused(dialog, `${key}: reopening after backdrop`)
    await page.keyboard.press('Escape'); await restored(`${key}: repeated Escape restoration`)
    await page.keyboard.press('Shift+Tab')
    await focused(page.getByRole('link', { name: 'Record', exact: true }), `${key}: previous tab stop`)
    await page.keyboard.press('Tab'); await focused(more, `${key}: next Tab returns to More`)
    await page.screenshot({ path: `${out}/menu-dismissed-${journey.width}-${journey.system}-${journey.reducedMotion || 'no-preference'}-${key}.png` })
    await page.keyboard.press(key); await dialog.waitFor()
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter')
    await page.waitForURL(base + '/games')
    await page.getByRole('heading', { name: 'Games, one night at a time.', exact: true }).waitFor()
    assert.equal(await trigger.evaluate(e => e === document.activeElement), false, `${key}: navigation does not reclaim trigger focus`)
    const destination = page.getByLabel('Game date', { exact: true })
    await destination.click()
    await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="More pages"]'))
    await page.keyboard.press('Escape')
    await focused(destination, `${key}: exit cleanup preserves destination control focus`)
    assert.equal(await more.getAttribute('aria-expanded'), 'false')
    journey.mobileMenu.push({ key, sheetFocused: true, tabOrder: ['Season preview', 'Games'], escapeReturnedToActualTrigger: true,
      backdropReturnedToActualTrigger: true, escapeReopenedDuringExit: true, backdropReopenedDuringExit: true,
      dismissalTabOrder: ['Record', 'More'],
      navigation: '/games', destinationFocusPreserved: true })
    await scan(page, journey, `menu-${key.toLowerCase()}`)
    await trigger.dispose()
    // Return by a real route change so the next case also navigates to a destination.
    await visit(page, '/')
  }
}

try {
  for (const width of [320, 390, 768, 1440]) for (const system of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: system, reducedMotion: 'no-preference' })
    await context.route('**://a.espncdn.com/**', route => route.abort())
    await context.route('**://site.web.api.espn.com/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await context.addInitScript(installMotionProbe)
    const legacyPreference = system === 'dark' ? 'vivid' : null
    if (legacyPreference) await context.addInitScript(value => localStorage.setItem('hardwood-ambient', value), legacyPreference)
    const page = await context.newPage(), journey = { width, system, legacyPreference, states: [] }
    report.journeys.push(journey)
    // No diagnostic rAF sampling loop: the motion probe observes only product callbacks.
    const collector = await browserDiagnostics(page, `${out}/diagnostics`, `${width}-${system}`, { trace: false, controlledScoreboard: true })
    page.qaDiagnostics = collector; collectors.push(collector)
    for (const [label, route] of [['home', '/'], ['team', '/teams/BOS'], ['slate', '/games'], ['upcoming', '/games/401909088'], ['archive-game', '/games/401859967'], ['player-unavailable', '/players/espn/900000001'], ['bracket', '/bracket'], ['predictor', '/predict'], ['accuracy', '/accuracy']]) {
      await visit(page, route); await scan(page, journey, label, ['home', 'team', 'bracket'].includes(label))
    }
    if (system === 'dark' && (width === 320 || width === 1440)) {
      await visit(page, '/teams/BOS')
      await page.locator('#team-schedule[data-ready="true"]').waitFor()
      await page.getByLabel('Schedule month').selectOption('2026-11')
      await page.getByLabel('Schedule court').selectOption('away')
      const details = page.locator('#team-schedule li details').first()
      await details.locator('summary').focus(); await page.keyboard.press('Enter')
      assert.equal(await details.evaluate(e => e.open), true)
      const teamUrl = page.url(), target = await details.getByRole('link', { name: /Open BOS/ }).getAttribute('href')
      await details.getByRole('link', { name: /Open BOS/ }).click(); await page.waitForURL(base + target)
      await page.locator('#main h1').waitFor(); await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(teamUrl); await page.waitForFunction(() => document.querySelector('[aria-label="Schedule court"]')?.value === 'away')
      await page.goForward(); await page.waitForURL(base + target); await page.goBack(); await page.waitForURL(teamUrl)
      await page.getByLabel('Schedule court').selectOption('away')
      await scan(page, journey, 'team-matchup-history')
      const chart = page.getByRole('img', { name: /Boston Celtics end-of-season Elo/ })
      await chart.scrollIntoViewIfNeeded(); const rect = await chart.boundingBox()
      await chart.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 })
      await page.locator('[data-chart-tooltip]').first().waitFor({ state: 'visible' })
      await scan(page, journey, 'chart-interaction')
      await visit(page, '/games?date=2026-10-21&team=BOS')
      await page.getByRole('heading', { name: 'No published games in this view', exact: true }).waitFor()
      await page.getByLabel('Game date', { exact: true }).fill('2026-10-20')
      await page.locator('#main a[href="/games/401909088"]').first().waitFor()
      await scan(page, journey, 'date-filter')
      await visit(page, '/predict?home=2&away=8')
      const home = await page.getByLabel('Home team', { exact: true }).inputValue(), away = await page.getByLabel('Away team', { exact: true }).inputValue()
      await page.getByRole('button', { name: 'Swap home and away', exact: true }).click()
      assert.equal(await page.getByLabel('Home team', { exact: true }).inputValue(), away)
      assert.equal(await page.getByLabel('Away team', { exact: true }).inputValue(), home)
      await scan(page, journey, 'predictor-swap')
      await visit(page, '/seasons/2026')
      const series = page.locator('#main a[href^="/seasons/2026/series/"]').first(), destination = await series.getAttribute('href')
      await series.click(); await page.waitForURL(base + destination); await page.getByRole('heading', { name: 'Every game', exact: true }).waitFor()
      await scan(page, journey, 'archive-bracket-navigation')
    }
    if (width < 768) await auditMoreMenu(page, journey)
    const diagnostics = await collector.finish(); assert.deepEqual(diagnostics.unexpected, [])
    journey.diagnostics = { unexpected: diagnostics.unexpected, consoleClassifications: diagnostics.events.filter(e => e.type === 'console').reduce((counts, e) => ({ ...counts, [e.classification]: (counts[e.classification] || 0) + 1 }), {}) }
    await context.close(); console.log(`Static production journey passed: ${width}px ${system}, ${journey.states.length} states`)
  }
  for (const width of [320, 390]) for (const system of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: system, reducedMotion: 'reduce' })
    await context.route('**://a.espncdn.com/**', route => route.abort())
    await context.route('**://site.web.api.espn.com/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await context.addInitScript(installMotionProbe)
    const page = await context.newPage(), journey = { width, system, reducedMotion: 'reduce', legacyPreference: null, states: [] }
    report.journeys.push(journey)
    const collector = await browserDiagnostics(page, `${out}/diagnostics`, `${width}-${system}-reduce`, { trace: false, controlledScoreboard: true })
    page.qaDiagnostics = collector; collectors.push(collector)
    await visit(page, '/'); await auditMoreMenu(page, journey)
    const diagnostics = await collector.finish(); assert.deepEqual(diagnostics.unexpected, [])
    journey.diagnostics = { unexpected: diagnostics.unexpected }
    await context.close(); console.log(`Reduced-motion menu journey passed: ${width}px ${system}`)
  }
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  await Promise.allSettled(collectors.map(collector => collector.finish()))
  await writeFile(`${out}/failure.json`, JSON.stringify(report, null, 2) + '\n')
  throw error
} finally { await browser.close() }
