// Actual production pages, normal motion, both OS color preferences; no provider fetches.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { browserDiagnostics } from './qa/browser_diagnostics.mjs'
import { installMotionProbe, motionState } from './qa/motion_probe.mjs'

const base = process.env.QA_BASE || 'http://127.0.0.1:3221'
const out = process.env.QA_OUT || '/tmp/nba-static-background-2026-10-12/product'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { at: new Date().toISOString(), chromium: browser.version(), baseCommit: '0c46874b9eff4b41459aaa9bc45f438954a13a9f', normalMotion: true, journeys: [] }
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
  const headings = { '/': 'Your front row to the forecast.', '/teams/BOS': 'Boston Celtics',
    '/games': 'Games, one night at a time.', '/games/401909088': 'Boston Celtics at Detroit Pistons',
    '/games/401859967': 'Scoring by period', '/players/espn/900000001': 'Player profile unavailable',
    '/bracket': 'The road to the title', '/predict': 'Any two teams', '/accuracy': 'How right has it been',
    '/seasons/2026': '2025-26 season' }
  await page.getByRole('heading', { name: headings[new URL(route, base).pathname], exact: true }).waitFor()
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === location.pathname)
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
      if (width < 768) {
        const more = page.getByRole('button', { name: 'More', exact: true })
        await more.focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog', { name: 'More pages', exact: true }).waitFor()
        await page.keyboard.press('Tab')
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('#mobile-more-sheet')), true)
        await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'More pages', exact: true }).waitFor({ state: 'hidden' })
        // Record focus restoration separately; the existing menu returns focus to
        // BODY on main too. Do not silently fix an unrelated baseline issue here.
        journey.mobileMenu = { keyboardOpened: true, tabReachedMenu: true, escapeClosed: true,
          focusReturnedToMore: await more.evaluate(e => e === document.activeElement),
          activeElementAfterEscape: await page.evaluate(() => document.activeElement.tagName) }
        await scan(page, journey, 'mobile-menu-keyboard')
      }
    }
    const diagnostics = await collector.finish(); assert.deepEqual(diagnostics.unexpected, [])
    journey.diagnostics = { unexpected: diagnostics.unexpected, consoleClassifications: diagnostics.events.filter(e => e.type === 'console').reduce((counts, e) => ({ ...counts, [e.classification]: (counts[e.classification] || 0) + 1 }), {}) }
    await context.close(); console.log(`Static production journey passed: ${width}px ${system}, ${journey.states.length} states`)
  }
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  await Promise.allSettled(collectors.map(collector => collector.finish()))
  await writeFile(`${out}/failure.json`, JSON.stringify(report, null, 2) + '\n')
  throw error
} finally { await browser.close() }
