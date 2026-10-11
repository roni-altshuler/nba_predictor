// Production journey over committed forecasts; external sources are controlled unavailable.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { browserDiagnostics } from './qa/browser_diagnostics.mjs'

const base = process.env.QA_BASE || 'http://127.0.0.1:3211'
const out = process.env.QA_OUT || '/tmp/nba-team-exploration-2026-10-11/product'
const artifact = JSON.parse(await readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const easternDay = date => new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const teamGames = artifact.games.filter(game => [game.home.abbreviation, game.away.abbreviation].includes('BOS'))
  .sort((a, b) => Date.parse(a.date_utc) - Date.parse(b.date_utc) || a.game_id.localeCompare(b.game_id))
const expectedRows = (month = '', court = '', count = 6) => teamGames
  .filter(game => (!month || easternDay(game.date_utc).startsWith(month))
    && (!court || (court === 'neutral' ? game.neutral_site : !game.neutral_site && (court === 'home' ? game.home.abbreviation === 'BOS' : game.away.abbreviation === 'BOS'))))
  .slice(0, count).map(game => game.game_id)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { at: new Date().toISOString(), chromium: browser.version(), baseCommit: '9cee669a169806a9535b74b4e5be83402a45069a', source: { generatedAt: artifact.generated_at, trainedThrough: artifact.trained_through, season: artifact.season }, journeys: [] }
const collectors = []
async function teamReady(page, month = '', court = '', count = 6) {
  await page.waitForURL(url => url.pathname === '/teams/BOS')
  await page.locator('#team-schedule[data-ready="true"]').waitFor()
  await page.waitForFunction(({ month, court, ids }) => document.querySelector('[aria-label="Schedule month"]')?.value === month
    && document.querySelector('[aria-label="Schedule court"]')?.value === court
    && JSON.stringify([...document.querySelectorAll('#team-schedule li[data-game-id]')].map(e => e.dataset.gameId)) === JSON.stringify(ids), { month, court, ids: expectedRows(month, court, count) })
  assert.deepEqual(await page.locator('#team-schedule li[data-game-id]').evaluateAll(elements => elements.map(e => e.dataset.gameId)), expectedRows(month, court, count))
}
async function gameReady(page, id) {
  const game = teamGames.find(game => game.game_id === id)
  await page.waitForURL(url => url.pathname === `/games/${id}`)
  await page.locator('#main').getByRole('heading', { name: `${game.away.name} at ${game.home.name}`, exact: true }).waitFor()
}
async function scan(page, journey, label, capture = false) {
  page.qaDiagnostics.mark(label)
  await page.waitForLoadState('networkidle')
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const state = await page.evaluate(async () => ({
    route: location.pathname + location.search + location.hash,
    overflow: document.documentElement.scrollWidth > innerWidth,
    rootBackground: getComputedStyle(document.body).backgroundColor,
    scheduleBackground: document.querySelector('#team-schedule') ? getComputedStyle(document.querySelector('#team-schedule')).backgroundColor : null,
    nativeSchemes: [...document.querySelectorAll('#team-schedule select')].map(e => getComputedStyle(e).colorScheme),
    violations: (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
  }))
  assert.equal(state.overflow, false); assert.deepEqual(state.violations, [])
  assert.equal(state.rootBackground, 'rgb(12, 7, 5)')
  if (state.scheduleBackground) { assert.equal(state.scheduleBackground, 'rgb(253, 246, 238)'); assert(state.nativeSchemes.every(scheme => scheme === 'light')) }
  await page.qaDiagnostics.checkpoint(label)
  journey.states.push({ label, ...state })
  await writeFile(`${out}/partial.json`, JSON.stringify(report, null, 2))
  if (capture) await page.screenshot({ path: `${out}/${label}-${journey.width}.png` })
}
async function openDetails(page, id) {
  const details = page.locator(`#team-schedule li[data-game-id="${id}"] details`)
  if (!await details.evaluate(e => e.open)) { await details.locator('summary').focus(); await page.keyboard.press('Enter') }
  assert.equal(await details.evaluate(e => e.open), true)
  return details
}
try {
  for (const [width, system] of [[320, 'light'], [390, 'dark'], [768, 'light'], [1440, 'dark']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: system, reducedMotion: 'reduce' })
    await context.route('**://a.espncdn.com/**', route => route.abort())
    await context.route('**://site.web.api.espn.com/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await context.addInitScript(() => localStorage.setItem('hardwood-ambient', 'off'))
    const page = await context.newPage(), journey = { width, system, states: [] }
    const collector = await browserDiagnostics(page, `${out}/diagnostics`, `${width}-${system}`, { controlledScoreboard: true })
    page.qaDiagnostics = collector; collectors.push(collector); report.journeys.push(journey)
    await page.goto(`${base}/games/401909088`); await gameReady(page, '401909088')
    await scan(page, journey, 'entry-game')
    await page.locator('#main header a[href="/teams/BOS"]').click(); await teamReady(page)
    const panel = page.locator('#team-schedule')
    journey.scheduleTop = await panel.evaluate(e => e.getBoundingClientRect().top + scrollY)
    const lastSeasonTop = await page.locator('#main').getByRole('heading', { name: /Last season/ }).evaluate(e => e.getBoundingClientRect().top + scrollY)
    assert(journey.scheduleTop < lastSeasonTop)
    assert(journey.scheduleTop < 650)
    await page.evaluate(() => scrollTo(0, 0)); await scan(page, journey, 'team-overview', true)
    assert.match(await panel.innerText(), /2026–27 · regular-season forecasts/i)
    assert.match(await panel.innerText(), /80 published fixtures/)
    for (const [label, id] of [['Season', 'team-season-outlook'], ['Players', 'team-players'], ['Ratings', 'team-rating-history'], ['Schedule', 'team-schedule']]) {
      await page.getByRole('navigation', { name: 'Team sections' }).getByRole('link', { name: label, exact: true }).click()
      assert.equal(new URL(page.url()).hash, `#${id}`); await page.locator(`#${id}`).waitFor()
      await teamReady(page)
    }
    await scan(page, journey, 'team-section-links')
    assert.match(await panel.innerText(), /Preseason exhibition games are outside/)
    await openDetails(page, '401909088'); await panel.scrollIntoViewIfNeeded(); await scan(page, journey, 'forecast-details', true)
    await page.getByRole('button', { name: 'Show 6 more games', exact: true }).focus(); await page.keyboard.press('Enter')
    await teamReady(page, '', '', 12); assert.equal(new URL(page.url()).searchParams.get('scheduleCount'), '12')
    await scan(page, journey, 'show-more')
    await page.reload(); await teamReady(page, '', '', 12); await scan(page, journey, 'reload-count')
    await page.goBack(); await teamReady(page); await page.goForward(); await teamReady(page, '', '', 12)
    await scan(page, journey, 'paging-back-forward')
    await page.getByLabel('Schedule month').selectOption('2026-11')
    await page.getByLabel('Schedule court').selectOption('away')
    await teamReady(page, '2026-11', 'away'); assert.equal(new URL(page.url()).searchParams.get('scheduleCount'), null)
    await panel.scrollIntoViewIfNeeded(); await scan(page, journey, 'november-away', true)
    const target = expectedRows('2026-11', 'away')[0], teamUrl = page.url()
    for (let repeat = 0; repeat < 2; repeat++) {
      const details = await openDetails(page, target)
      await details.getByRole('link', { name: /Open BOS/ }).click(); await gameReady(page, target)
      await scan(page, journey, `matchup-${repeat + 1}`)
      await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.waitForURL(teamUrl); await teamReady(page, '2026-11', 'away')
      await page.goForward(); await gameReady(page, target); await page.goBack(); await teamReady(page, '2026-11', 'away')
      await scan(page, journey, `restored-${repeat + 1}`)
    }
    const details = await openDetails(page, target)
    await details.getByRole('link', { name: 'View this day’s slate →' }).click()
    await page.waitForURL(url => url.pathname === '/games' && url.searchParams.get('team') === 'BOS')
    await page.getByRole('heading', { name: 'Games, one night at a time.', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Game date', { exact: true }).inputValue(), easternDay(teamGames.find(game => game.game_id === target).date_utc))
    assert.equal(await page.getByLabel('Filter by franchise').inputValue(), 'BOS')
    await scan(page, journey, 'daily-slate'); await page.goBack(); await teamReady(page, '2026-11', 'away')
    // Hold an uncached RSC response, navigate back, then release it. A late result must not replace the restored team view.
    const interruptedId = expectedRows('2026-11', 'away')[1]
    let release, observed
    const held = new Promise(resolve => { observed = resolve }), gate = new Promise(resolve => { release = resolve })
    const pattern = `**/games/${interruptedId}*`
    const handler = async route => {
      if (route.request().headers().rsc === '1') { observed(); await gate }
      await route.continue()
    }
    await page.route(pattern, handler)
    const interruptedDetails = await openDetails(page, interruptedId)
    await interruptedDetails.getByRole('link', { name: /Open BOS/ }).click({ noWaitAfter: true })
    await Promise.race([held, new Promise((_, reject) => setTimeout(() => reject(new Error('RSC interruption was not exercised')), 10000))])
    // Cancel the pending matchup by choosing the already visited day slate.
    const knownDetails = await openDetails(page, target)
    await knownDetails.getByRole('link', { name: 'View this day’s slate →' }).click({ noWaitAfter: true })
    await page.waitForURL(url => url.pathname === '/games' && url.searchParams.get('team') === 'BOS')
    await page.getByRole('heading', { name: 'Games, one night at a time.', exact: true }).waitFor()
    release(); await page.waitForLoadState('networkidle'); await page.unroute(pattern, handler)
    assert.equal(new URL(page.url()).pathname, '/games')
    await scan(page, journey, 'interrupted-response-slate')
    await page.goto(teamUrl); await teamReady(page, '2026-11', 'away')
    await scan(page, journey, 'interrupted-response-return')
    journey.interruption = { exercised: true, heldRscGame: interruptedId, lateResponseDidNotReplaceSlate: true, sharedTeamFiltersRestored: true }
    await page.getByLabel('Schedule court').selectOption('neutral'); await teamReady(page, '2026-11', 'neutral')
    await page.getByRole('heading', { name: 'No published games match these filters' }).waitFor()
    await scan(page, journey, 'empty-filter', true)
    await page.getByRole('button', { name: 'Reset schedule' }).click(); await teamReady(page)
    await scan(page, journey, 'reset')
    // A malformed shared URL must leave the page usable, while preserving unrelated query state when reset.
    await page.goto(`${base}/teams/BOS?scheduleMonth=2026-99&scheduleVenue=roof&scheduleCount=99999999999999999&other=keep#team-schedule`)
    await teamReady(page); await scan(page, journey, 'invalid-shared-url')
    await page.getByLabel('Schedule court').selectOption('home'); await page.getByRole('button', { name: 'Reset schedule' }).click()
    assert.equal(new URL(page.url()).searchParams.get('other'), 'keep'); await teamReady(page)
    journey.diagnostics = await collector.finish(); assert.deepEqual(journey.diagnostics.unexpected, [])
    await context.close(); console.log(`Team schedule journey passed: ${width}px, ${journey.states.length} states`)
  }
  const cold = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
  await cold.route('**://a.espncdn.com/**', route => route.abort())
  await cold.route('**://site.web.api.espn.com/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
  await cold.route('**/_next/static/**/*.js', async route => { await new Promise(resolve => setTimeout(resolve, 1600)); await route.continue() })
  const page = await cold.newPage(), coldCollector = await browserDiagnostics(page, `${out}/diagnostics`, 'cold-shared-filters', { controlledScoreboard: true })
  page.qaDiagnostics = coldCollector; collectors.push(coldCollector)
  await page.goto(`${base}/teams/BOS?scheduleMonth=2026-11&scheduleVenue=away&scheduleCount=12#team-schedule`, { waitUntil: 'commit' })
  await page.locator('#team-schedule').waitFor()
  const initial = await page.locator('#team-schedule').evaluate(element => ({ busy: element.getAttribute('aria-busy'), disabledControls: [...element.querySelectorAll('select')].every(e => e.disabled), status: element.querySelector('[role="status"]').textContent }))
  assert.equal(initial.busy, 'true'); assert.equal(initial.disabledControls, true); assert.equal(initial.status, 'Restoring schedule filters…')
  await teamReady(page, '2026-11', 'away', 12)
  report.coldLoad = { initial, restoredSharedFilters: true, states: [] }
  await scan(page, report.coldLoad, 'cold-shared-filters')
  report.coldLoad.diagnostics = await coldCollector.finish(); assert.deepEqual(report.coldLoad.diagnostics.unexpected, [])
  await cold.close()
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  await Promise.allSettled(collectors.map(c => c.finish()))
  await writeFile(`${out}/failure.json`, JSON.stringify(report, null, 2) + '\n')
  throw error
} finally { await browser.close() }
