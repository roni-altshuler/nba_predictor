// Production games-first homepage over committed artifacts; all provider calls controlled unavailable.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { browserDiagnostics } from './qa/browser_diagnostics.mjs'
import { installMotionProbe, motionState } from './qa/motion_probe.mjs'

const base = process.env.QA_BASE || 'http://127.0.0.1:3231'
const out = process.env.QA_OUT || '/tmp/nba-home-slate-2026-10-12/product'
const forecast = JSON.parse(await readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const dayOf = date => new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const firstDay = [...new Set(forecast.games.map(g => dayOf(g.date_utc)))].sort()[0]
const games = forecast.games.filter(g => dayOf(g.date_utc) === firstDay)
const nextDay = [...new Set(forecast.games.map(g => dayOf(g.date_utc)))].sort()[1]
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { at: new Date().toISOString(), chromium: browser.version(), baseCommit: '7d616eb456ed9222e982be111498b6f2f486a025', source: { firstDay, games: games.map(g => g.game_id), generatedAt: forecast.generated_at, trainedThrough: forecast.trained_through }, journeys: [] }
const collectors = []
async function home(page) {
  await page.waitForURL(url => url.pathname === '/')
  await page.getByRole('heading', { name: 'NBA games & scores', exact: true }).waitFor()
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === '/')
  assert.deepEqual(await page.locator('#home-games article').evaluateAll(es => es.map(e => e.dataset.gameId)), games.map(g => g.game_id))
}
async function scan(page, journey, label, capture = false) {
  page.qaDiagnostics.mark(label); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200)
  const before = await page.evaluate(motionState); await page.waitForTimeout(500); const after = await page.evaluate(motionState)
  assert.equal(after.canvases, 0); assert.equal(after.ambientNodes, 0); assert.equal(after.pending, 0)
  assert.equal(after.executed - before.executed, 0); assert.equal(after.draws - before.draws, 0)
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const state = await page.evaluate(async () => ({ route: location.pathname + location.search + location.hash,
    overflow: document.documentElement.scrollWidth > innerWidth,
    violations: (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
  }))
  assert.equal(state.overflow, false); assert.deepEqual(state.violations, [])
  journey.states.push({ label, ...state, idleFrameDelta: after.executed - before.executed, canvasDrawDelta: after.draws - before.draws })
  await page.qaDiagnostics.checkpoint(label)
  if (capture) await page.screenshot({ path: `${out}/${label}-${journey.width}.png` })
  await writeFile(`${out}/partial.json`, JSON.stringify(report, null, 2))
}
async function outlook(page, id) {
  const details = page.locator(`[data-model-outlook="${id}"]`)
  if (!await details.evaluate(e => e.open)) { await details.locator('summary').focus(); await page.keyboard.press('Enter') }
  assert.equal(await details.evaluate(e => e.open), true)
  return details
}
try {
  for (const [width, system] of [[320, 'light'], [390, 'dark'], [768, 'light'], [1024, 'dark'], [1440, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: system, reducedMotion: 'no-preference' })
    await context.route('**://a.espncdn.com/**', route => route.abort())
    await context.route('**://site.web.api.espn.com/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await context.addInitScript(installMotionProbe)
    const page = await context.newPage(), journey = { width, system, states: [] }
    report.journeys.push(journey)
    const diagnostics = await browserDiagnostics(page, `${out}/diagnostics`, `${width}-${system}`, { trace: false, controlledScoreboard: true })
    page.qaDiagnostics = diagnostics; collectors.push(diagnostics)
    await page.goto(base); await home(page)
    assert.equal(await page.locator('#home-games [data-model-outlook][open]').count(), 0)
    assert.equal(await page.locator('#home-season-outlook').evaluate(e => e.open), false)
    assert.equal(await page.getByRole('article', { name: 'Selected matchup' }).count(), 0)
    await page.getByText(/No settled regular-season forecasts yet/).waitFor()
    journey.slateTop = await page.locator('#home-games').evaluate(e => e.getBoundingClientRect().top + scrollY)
    journey.cards = await page.locator('#home-games article').evaluateAll(es => es.map(e => ({ id: e.dataset.gameId, top: e.getBoundingClientRect().top + scrollY, height: e.getBoundingClientRect().height })))
    assert(journey.slateTop < 400)
    const first = page.locator(`#home-games article[data-game-id="${games[0].game_id}"]`)
    const summaryBox = await first.locator('summary').boundingBox(), linkBox = await first.getByRole('link', { name: 'Matchup & players →' }).boundingBox()
    assert(summaryBox.x + summaryBox.width <= linkBox.x, 'Separate controls must not overlap')
    await scan(page, journey, 'home', true)
    const details = await outlook(page, games[0].game_id)
    await details.getByText(new RegExp(`${(games[0].p_home * 100).toFixed(1)}% published win chance`)).waitFor()
    await details.scrollIntoViewIfNeeded(); await scan(page, journey, 'model-outlook', true)
    for (let repeat = 0; repeat < 2; repeat++) {
      await (await outlook(page, games[0].game_id)).getByRole('link', { name: 'Forecast evidence & details →' }).click()
      await page.waitForURL(url => url.pathname === `/games/${games[0].game_id}` && url.hash === '#forecast')
      await page.getByRole('heading', { name: `${games[0].away.name} at ${games[0].home.name}`, exact: true }).waitFor()
      await scan(page, journey, `matchup-${repeat + 1}`)
      await page.getByRole('button', { name: 'Back', exact: true }).click(); await home(page)
      await page.goForward(); await page.waitForURL(url => url.pathname === `/games/${games[0].game_id}`)
      await page.goBack(); await home(page); await scan(page, journey, `matchup-return-${repeat + 1}`)
    }
    await page.goto(base); await home(page)
    await first.getByRole('link', { name: 'Boston Celtics team page', exact: true }).click()
    await page.locator('#team-schedule[data-ready="true"]').waitFor()
    await page.getByLabel('Schedule month').selectOption('2026-11'); await page.getByLabel('Schedule court').selectOption('away')
    await page.getByRole('button', { name: 'Show 6 more games', exact: true }).click()
    const teamUrl = page.url(); await page.reload(); await page.waitForFunction(() => document.querySelector('[aria-label="Schedule court"]')?.value === 'away')
    assert.equal(new URL(page.url()).searchParams.get('scheduleCount'), '12')
    await scan(page, journey, 'team-shared-filters')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/teams/BOS' && !url.searchParams.has('scheduleCount'))
    assert.equal(await page.getByLabel('Schedule court').inputValue(), 'away')
    await page.goForward(); await page.waitForURL(teamUrl); await page.getByLabel('Schedule court').waitFor()
    await page.getByRole('link', { name: 'Hardwood', exact: true }).click(); await home(page)
    // Hold a distinct uncached RSC navigation, then choose a team instead.
    let arrived, release
    const held = new Promise(resolve => { arrived = resolve }), gate = new Promise(resolve => { release = resolve })
    const pattern = `**/games/${games[1].game_id}?_rsc=*`
    const handler = async route => { arrived(); await gate; await route.continue() }
    await page.route(pattern, handler)
    await page.locator(`#home-games article[data-game-id="${games[1].game_id}"]`).getByRole('link', { name: 'Matchup & players →' }).click({ noWaitAfter: true })
    await Promise.race([held, new Promise((_, reject) => setTimeout(() => reject(new Error('RSC interruption was not exercised')), 10000))])
    await first.getByRole('link', { name: 'Boston Celtics team page', exact: true }).click({ noWaitAfter: true })
    await page.waitForURL(url => url.pathname === '/teams/BOS'); await page.locator('#team-schedule[data-ready="true"]').waitFor()
    release(); await page.waitForLoadState('networkidle'); await page.unroute(pattern, handler)
    assert.equal(new URL(page.url()).pathname, '/teams/BOS')
    journey.interruption = { exercised: true, heldGame: games[1].game_id, lateResponseDidNotReplaceTeam: true }
    await scan(page, journey, 'interrupted-navigation')
    await page.goto(base); await home(page)
    await page.getByRole('link', { name: 'Daily slate →', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/games' && url.searchParams.get('date') === firstDay)
    await page.getByLabel('Filter by franchise', { exact: true }).selectOption('BOS')
    await page.getByLabel('Game date', { exact: true }).fill('2026-10-21')
    await page.getByRole('heading', { name: 'No published games in this view', exact: true }).waitFor()
    await scan(page, journey, 'empty-date', true)
    await page.getByLabel('Game date', { exact: true }).fill(firstDay)
    await page.locator('#main a[href="/games/401909088"]').first().waitFor(); await scan(page, journey, 'date-recovery')
    await page.goto(base); await home(page)
    await page.locator('#home-season-outlook summary').focus(); await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Title odds', exact: true }).waitFor(); await scan(page, journey, 'season-details')
    const timing = page.locator('#home-games details').filter({ has: page.getByText('Forecast timing & coverage', { exact: true }) })
    await timing.locator('summary').focus(); await page.keyboard.press('Enter')
    await timing.getByText(/Published/).waitFor(); await scan(page, journey, 'publication-details')
    journey.nextSlateHref = await page.getByRole('navigation', { name: 'More published slate dates', exact: true }).locator(`a[href="/games?date=${nextDay}"]`).getAttribute('href')
    const d = await diagnostics.finish(); assert.deepEqual(d.unexpected, [])
    journey.diagnostics = { unexpected: d.unexpected, controlledConsoleCounts: d.events.filter(e => e.type === 'console').reduce((n,e) => ({...n,[e.classification]:(n[e.classification]||0)+1}), {}) }
    await context.close(); console.log(`Homepage passed: ${width}px, ${journey.states.length} states`)
  }
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  await Promise.allSettled(collectors.map(d => d.finish()))
  await writeFile(`${out}/failure.json`, JSON.stringify(report, null, 2) + '\n')
  throw error
} finally { await browser.close() }
