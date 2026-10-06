// Browser QA against an isolated server with scripts/qa/player_profile_fixture.cjs.
// QA Guard / QA Reserve and their athlete IDs are synthetic, never live coverage.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const base = process.env.QA_BASE || 'http://127.0.0.1:3150'
const out = process.env.QA_OUT || '/tmp/nba-player-profile-qa'
await mkdir(out, { recursive: true })
const source = JSON.parse(await readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const upcoming = source.games.find(g => [g.home.abbreviation, g.away.abbreviation].includes('NY') && [g.home.abbreviation, g.away.abbreviation].includes('SA'))
assert(upcoming)
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(upcoming.date_utc))
const origin = `/games?date=${day}&team=NY`
const profileUrl = '/players/espn/900000001?game=401859967&team=18'
const results = { basis: 'Synthetic ESPN box-score fixture; committed game/team context', widths: [] }
const browser = await chromium.launch({ ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}) })
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
const accessibility = async page => {
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))
  assert.deepEqual(violations, [])
  return violations
}
const ready = page => page.locator('[aria-label="Daily slate"][data-ready="true"]').waitFor()
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    const errors = []
    const portraitRequests = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/headshot|\/athletes\//i.test(request.url())) portraitRequests.push(request.url()) })
    await page.goto(`${base}/teams/NY`)
    const teamPlayers = page.getByRole('region', { name: 'Explore players' })
    const recentGame = teamPlayers.locator('a').first()
    assert.equal(await recentGame.getAttribute('href'), '/games/401859967#player-box-scores')
    await recentGame.focus()
    await page.keyboard.press('Enter')
    const box = page.locator('#player-box-scores')
    await box.locator('table').waitFor()
    const guard = box.locator('table').getByRole('link', { name: 'QA Guard', exact: true })
    assert.equal(await guard.getAttribute('href'), profileUrl)
    for (const link of await box.getByRole('link', { name: 'QA Guard', exact: true }).all()) assert.equal(await link.getAttribute('href'), profileUrl)
    await noOverflow(page)
    await guard.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'QA Guard', exact: true }).waitFor()
    assert.equal(await page.getByText('29', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Unavailable', { exact: true }).count(), 3)
    assert.equal(await page.locator('article img').count(), 0)
    await noOverflow(page)
    const profileAccessibility = await accessibility(page)
    await page.screenshot({ path: `${out}/profile-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await box.locator('table').waitFor()
    assert.equal(new URL(page.url()).hash, '#player-box-scores')
    await box.getByRole('link', { name: 'QA Reserve', exact: true }).click()
    await page.getByRole('heading', { name: 'QA Reserve', exact: true }).waitFor()
    await page.getByText('QA DNP reason', { exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Single-game statistics' }).count(), 0)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await box.locator('table').waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL('**/teams/NY')

    // From a filtered slate through the published previous meeting into a player.
    await page.goto(`${base}${origin}`)
    await ready(page)
    await page.locator(`a[href="/games/${upcoming.game_id}"]`).click()
    await page.locator('a[href="/games/401859967"]').first().click()
    await box.locator('table').waitFor()
    await box.locator('table').getByRole('link', { name: 'QA Guard', exact: true }).click()
    await page.getByRole('heading', { name: 'QA Guard', exact: true }).waitFor()
    for (const url of [`**/games/401859967`, `**/games/${upcoming.game_id}`, `**${origin}`]) {
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(url)
    }
    await ready(page)
    assert.equal(await page.getByLabel('Game date', { exact: true }).inputValue(), day)
    assert.equal(await page.getByLabel('Filter by franchise').inputValue(), 'NY')
    await page.goForward()
    await page.waitForURL(`**/games/${upcoming.game_id}`)
    await page.goBack()
    await ready(page)
    assert.equal(await page.getByLabel('Filter by franchise').inputValue(), 'NY')

    // Known archived game with no response in the controlled fixture: honest failure.
    await page.goto(`${base}/players/espn/900000001?game=401859966&team=18`)
    await page.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
    await page.getByText(/ESPN player box score is unavailable/).waitFor()
    assert.equal(await page.getByText('QA Guard', { exact: true }).count(), 0)
    await noOverflow(page)
    const unavailableAccessibility = await accessibility(page)
    await page.screenshot({ path: `${out}/unavailable-${width}.png`, fullPage: true })
    await page.goto(`${base}/players/espn/900000001`)
    await page.getByRole('heading', { name: 'Choose a completed game' }).waitFor()
    await page.goto(`${base}/players/espn/900000001?game=401859967&team=20`)
    await page.getByText(/not a participant/).waitFor()
    await page.goto(`${base}/players/nba/900000001?game=401859967&team=18`)
    await page.getByText('Nothing lives at this address.', { exact: false }).waitFor()
    assert.deepEqual(errors, [])
    assert.deepEqual(portraitRequests, [])
    results.widths.push({ width, keyboardTeamGamePlayer: true, leaderIdentity: true, dnp: true, filteredOriginBackForward: true, unavailableAndMissingContext: true, warehouseTeamRejected: true, nbaNamespaceRejected: true, noOverflow: true, profileAccessibility, unavailableAccessibility, portraitRequests, browserErrors: errors })
    await context.close()
    console.log(`Player flows passed at ${width}px`)
  }
  const cold = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await cold.newPage()
  await page.goto(`${base}${profileUrl}`)
  await page.getByRole('link', { name: 'Game box score', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Game box score', exact: true }).getAttribute('href'), '/games/401859967#player-box-scores')
  results.coldGameFallback = true
  await cold.close()
} finally {
  await browser.close()
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n')
}
