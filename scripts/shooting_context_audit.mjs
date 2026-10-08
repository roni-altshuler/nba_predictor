// Real Chromium, actual archive boxes. ESPN deliberately unavailable; no provider collection.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'

const base = process.env.QA_BASE || 'http://127.0.0.1:3180'
const fixture = process.env.QA_FIXTURE_BASE || 'http://127.0.0.1:3181'
const out = process.env.QA_OUT || '/tmp/nba-shooting-context-qa'
const fail = '/tmp/nba-shooting-qa-fail'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const source = JSON.parse(await readFile('backend/data/history/season_2026.json', 'utf8'))
const forecast = JSON.parse(await readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const target = source.games.find(game => game.id === '401859967')
const results = { basis: 'Real committed team archive; unmodified production app with ESPN responses controlled to HTTP 503. Isolated development copy for delayed/error shared boundaries only.', widths: [], states: [], serialization: {} }
const ready = page => page.locator('#shooting-context[data-ready="true"]').waitFor()
const controls = async (page, season, window) => {
  await page.waitForFunction(([s, w]) => document.querySelector('select[id$="-season"]')?.value === s && document.querySelector('select[id$="-window"]')?.value === w, [String(season), String(window)])
}
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
const axe = async page => {
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))
  assert.deepEqual(violations, [])
}
const shot = async (page, width, name) => {
  const card = page.locator('#shooting-context')
  await page.setViewportSize({ width, height: Math.max(1100, Math.ceil((await card.boundingBox()).height) + 220) })
  await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: `${out}/${name}-${width}.png` })
  await page.setViewportSize({ width, height: 1000 })
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage(), errors = [], externalPlayerRequests = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/headshot|\/athletes\//i.test(request.url())) externalPlayerRequests.push(request.url()) })
    await page.goto(`${base}/games/401859967#shooting-context`); await ready(page)
    const region = page.getByRole('region', { name: 'Shooting context', exact: true })
    assert.match(await region.innerText(), /Before Jun 13, 2026 ET/i)
    assert.equal(await page.getByRole('heading', { name: 'No player box score', exact: true }).count(), 1)
    const teamTable = region.getByRole('table', { name: 'NY recent shooting rates', exact: true })
    // Independent check against the real stored prior NY boxes, not a generated fixture number.
    const games = source.games.filter(g => (g.home_id === target.away_id || g.away_id === target.away_id) && [2, 3, 5].includes(g.type) && Date.parse(g.date) < Date.parse(target.date)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 10)
    const boxes = games.map(g => g.home_id === target.away_id ? g.box_home : g.box_away)
    const attempts = boxes.reduce((n, b) => n + b.fga, 0)
    const efg = (100 * boxes.reduce((n, b) => n + b.fgm + 0.5 * b.fg3m, 0) / attempts).toFixed(1) + '%'
    assert.equal(await teamTable.getByText(efg, { exact: true }).count(), 1)
    const window = page.getByLabel('Recent games', { exact: true })
    await window.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
    await controls(page, 2026, 5)
    assert.equal(await window.evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
    await page.goBack(); await controls(page, 2026, 10)
    await page.goForward(); await controls(page, 2026, 5)
    await page.reload(); await ready(page); await controls(page, 2026, 5)
    await page.getByLabel('Season sample', { exact: true }).selectOption('2025'); await controls(page, 2025, 5)
    assert.match(await region.getByRole('status').innerText(), /Prior-season reference/)
    await page.goBack(); await controls(page, 2026, 5)
    await page.goForward(); await controls(page, 2025, 5)
    for (let i = 0; i < 3; i++) {
      await page.getByLabel('Season sample', { exact: true }).selectOption('2026')
      await window.selectOption('10'); await window.selectOption('5')
    }
    await controls(page, 2026, 5)
    const summary = region.locator('summary').filter({ hasText: 'Included games (5)' }).first()
    await summary.focus(); await page.keyboard.press('Enter')
    const links = await region.locator('ol a').all()
    for (const link of links) {
      const id = (await link.getAttribute('href')).split('/').at(-1)
      const row = source.games.find(game => game.id === id)
      assert(row && Date.parse(row.date) < Date.parse(target.date) && row.id !== target.id)
    }
    const returnUrl = page.url()
    await links[0].focus(); await page.keyboard.press('Enter')
    await page.waitForURL(`**/games/${games[0].id}`); await ready(page)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(returnUrl); await ready(page); await controls(page, 2026, 5)
    await page.goForward(); await ready(page)
    await page.goBack(); await ready(page); await controls(page, 2026, 5)
    await region.locator('summary').filter({ hasText: 'How to read these numbers' }).click()
    assert.match(await region.innerText(), /Counts are summed before division/)
    assert.equal(await region.evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 0)
    await noOverflow(page); await axe(page)
    await shot(page, width, 'shooting')
    await page.goto(`${base}/games/${forecast.games[0].game_id}#shooting-context`); await ready(page)
    const entries = await page.evaluate(() => history.length)
    await page.getByRole('link', { name: 'Shooting context', exact: true }).click()
    assert.equal(await page.evaluate(() => document.activeElement.id), 'shooting-context')
    assert.equal(await page.evaluate(() => history.length), entries)
    assert.match(await page.locator('#shooting-context').innerText(), /No 2026–27 season archive is available/)
    await noOverflow(page); await axe(page); await shot(page, width, 'shooting-empty')
    await page.getByRole('button', { name: 'View prior-season reference', exact: true }).focus(); await page.keyboard.press('Enter')
    await controls(page, 2026, 10)
    assert.match(await page.locator('#shooting-context').innerText(), /different roster context/)
    await noOverflow(page); await axe(page); await shot(page, width, 'shooting-prior')
    // A first archived season game has a valid empty pre-game sample.
    const first = source.games[0]
    await page.goto(`${base}/games/${first.id}?scoutSeason=2026&scoutWindow=5#shooting-context`); await ready(page)
    assert.match(await page.locator('#shooting-context').innerText(), /No eligible earlier games/)
    await noOverflow(page); await axe(page)
    assert.deepEqual(errors, []); assert.deepEqual(externalPlayerRequests, [])
    results.widths.push({ width, realArchiveRates: true, keyboardFocus: true, sectionJumpFocusWithoutHistoryEntry: true, shareReloadBackForward: true, repeatedSelection: true, includedGameLinksAndContextualBack: true, currentSeasonEmptyAndPriorReference: true, firstGameEmpty: true, source503StillHasTeamContext: true, reducedMotion: true, horizontalOverflow: false, axeViolations: [], browserErrors: errors })
    await context.close(); console.log(`Shooting-context browser flows passed at ${width}px`)
  }
  // Real partial coverage from 2016, without manufacturing missing columns.
  const partialSeason = JSON.parse(await readFile('backend/data/history/season_2016.json', 'utf8'))
  const partialTarget = partialSeason.games.find(game => {
    const prior = partialSeason.games.filter(row => (row.home_id === game.home_id || row.away_id === game.home_id) && Date.parse(row.date) < Date.parse(game.date) && [2, 3, 5].includes(row.type)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 10)
    return prior.length === 10 && prior.some(row => !(row.home_id === game.home_id ? row.box_home : row.box_away)?.fga)
  })
  assert(partialTarget)
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(`${base}/games/${partialTarget.id}#shooting-context`); await ready(page)
  assert.match(await page.locator('#shooting-context').innerText(), /(?:^|\s)[0-9]\/10 games/)
  await noOverflow(page); await axe(page); await shot(page, 390, 'shooting-partial')
  results.states.push({ realPartialArchiveGame: partialTarget.id, missingCoverageVisible: true })
  const html = await (await context.request.get(`${base}/games/${forecast.games[0].game_id}`)).text()
  const rsc = await (await context.request.get(`${base}/games/${forecast.games[0].game_id}`, { headers: { RSC: '1' } })).text()
  assert.equal(forecast.games.slice(1).filter(g => html.includes(g.game_id) || rsc.includes(g.game_id)).length, 0)
  let compactData
  const inspect = value => {
    if (!value || typeof value !== 'object') return
    if (value.gameDate && value.gameSeason && Array.isArray(value.scopes)) compactData = value
    for (const item of Object.values(value)) inspect(item)
  }
  for (const line of rsc.split('\n')) { try { inspect(JSON.parse(line.slice(line.indexOf(':') + 1))) } catch {} }
  assert(compactData, 'The actual RSC must contain the bounded shooting-context data')
  const clientBytes = Buffer.byteLength(JSON.stringify(compactData))
  assert(clientBytes < 20000)
  for (const scope of compactData.scopes) for (const team of scope.teams) assert(team.samples[10].results.length <= 10)
  results.serialization = { upcomingHtmlBytes: Buffer.byteLength(html), upcomingRscBytes: Buffer.byteLength(rsc), shootingClientDataBytes: clientBytes, unrelatedForecastIds: 0 }
  await context.close()

  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto(`${fixture}/teams/NY`)
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === '/teams/NY')
    await writeFile(fail, 'controlled failure')
    await page.getByRole('link', { name: 'QA controlled shooting route', exact: true }).click()
    const loading = page.getByLabel('Loading game', { exact: true })
    await loading.waitFor(); await noOverflow(page)
    assert.equal(await loading.locator('.skeleton-shimmer').first().evaluate(el => getComputedStyle(el, '::after').animationName), 'none')
    await page.screenshot({ path: `${out}/shooting-loading-${width}.png` })
    await page.getByRole('heading', { name: "This page couldn't load", exact: true }).waitFor()
    await noOverflow(page); await axe(page); await page.screenshot({ path: `${out}/shooting-error-${width}.png` })
    await unlink(fail)
    await page.getByRole('button', { name: 'Try again', exact: true }).focus(); await page.keyboard.press('Enter')
    await ready(page); await noOverflow(page); await axe(page)
    results.states.push({ width, actualSharedLoadingAndErrorBoundary: true, keyboardRetryToShootingContext: true, reducedMotionLoading: true, horizontalOverflow: false, axeViolations: [] })
    await context.close()
  }
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n')
} finally { await unlink(fail).catch(() => {}); await browser.close() }
