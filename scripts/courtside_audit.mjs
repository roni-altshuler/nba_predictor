// Verifies actual published data. Only the explicit refresh-failure case is mocked.
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const base = process.env.QA_BASE || 'http://127.0.0.1:3002'
const out = process.env.QA_OUT || '/tmp/hardwood-courtside'
await mkdir(out, { recursive: true })
const source = JSON.parse(await readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [390, 320, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.setDefaultNavigationTimeout(180000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const response = await context.request.get(`${base}/api/v1/courtside`, { timeout: 180000 })
    assert.equal(response.status(), 200)
    const data = await response.json()
    const game = data.games.find(g => Date.parse(g.date_utc) > Date.now())
    assert(game, 'Needs a real upcoming game')
    assert.deepEqual(game, source.games.find(g => g.game_id === game.game_id))
    await page.goto(`${base}/lab?game=${game.game_id}`, { waitUntil: 'domcontentloaded' })
    const selected = page.getByRole('article', { name: 'Selected matchup' })
    await selected.getByRole('link', { name: 'Game breakdown ↗' }).waitFor()
    assert.equal(await selected.getByRole('link', { name: 'Game breakdown ↗' }).getAttribute('href'), `/games/${game.game_id}`)
    console.log(`Loaded ${width}px`)
    await page.screenshot({ path: `${out}/initial-${width}.png`, fullPage: true })
    if (width === 390) {
    await selected.getByRole('button', { name: '95%', exact: true }).click()
    await selected.getByText('Central 95%', { exact: false }).waitFor()
    await selected.getByRole('button', { name: '80%', exact: true }).click()
    const directory = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: 'Your teams' }) })
    await directory.locator('summary').click()
    assert.equal(await directory.getByRole('button').count(), 30)
    await directory.locator('summary').click()
    await selected.getByRole('button', { name: `+ Follow ${game.home.name}`, exact: true }).click()
    await page.getByRole('button', { name: 'Following', exact: true }).click()
    await selected.getByRole('button', { name: `${game.home.abbreviation} wins` }).click()
    await selected.getByRole('status').filter({ hasText: 'hypothetical record' }).waitFor()
    await selected.getByRole('button', { name: 'Copy matchup link' }).click()
    await page.getByRole('status').filter({ hasText: 'Matchup link copied.' }).waitFor()
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes(`game=${game.game_id}`))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selected.getByRole('button', { name: `✓ Following ${game.home.name}`, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close calls', exact: true }).click()
    await page.getByText('Close calls: each team', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'All games', exact: true }).click()
    await page.getByRole('combobox', { name: 'Filter by team' }).selectOption(game.home.abbreviation)
    assert.equal(new URL(page.url()).searchParams.get('team'), game.home.abbreviation)
    await page.getByRole('button', { name: 'Close calls', exact: true }).click()
    assert.equal(new URL(page.url()).searchParams.get('mode'), 'close')
    await page.goBack()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'All games' && button.getAttribute('aria-pressed') === 'true'))
    assert.equal(await page.getByRole('button', { name: 'All games', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('combobox', { name: 'Filter by team' }).inputValue(), game.home.abbreviation)
    await page.getByRole('button', { name: 'Refresh forecasts', exact: true }).click()
    await page.getByRole('status').filter({ hasText: /Latest published forecasts loaded\.|Could not refresh\./ }).waitFor()
    console.log('Refresh:', await page.getByRole('status').filter({ hasText: /Latest published|Could not refresh/ }).innerText())
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${out}/lab-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`)
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) })))
    assert.deepEqual(violations, [], `Accessibility at ${width}`)
    if (width === 390) {
      await page.route('**/api/v1/courtside', route => route.fulfill({ status: 503, body: '{}' }))
      await page.getByRole('button', { name: 'Refresh forecasts' }).click()
      await page.getByRole('status').filter({ hasText: 'Could not refresh.' }).waitFor()
      assert(await selected.isVisible())
    }
    if (width === 1440) {
      await page.goto(base, { waitUntil: 'domcontentloaded' })
      await page.getByRole('heading', { name: 'Your front row to the forecast.' }).waitFor()
      for (const homeWidth of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width: homeWidth, height: 1000 })
        await page.screenshot({ path: `${out}/home-${homeWidth}.png`, fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Home overflow at ${homeWidth}`)
      }
    }
    assert.deepEqual(errors, [], `Browser errors at ${width}`)
    console.log(`Passed ${width}px`)
    results.push({ width, errors, violations, upcoming: data.games.length })
    await context.close()
  }
} finally { await browser.close() }
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify({ source: 'Committed NBA forecast artifact via local API', results, screenshots: out }, null, 2))
