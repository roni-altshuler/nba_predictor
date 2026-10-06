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
const results = { basis: 'Synthetic ESPN box-score fixture; committed game/team context', widths: [], historical: [] }
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
    await page.getByText('Source: ESPN final game summary. Stats describe this game only. Source update time unavailable.', { exact: true }).waitFor()
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

  const historicalCases = [
    { game: '231030025', team: '25', year: 2003, reported: 'Seattle SuperSonics', franchise: 'Oklahoma City Thunder', abbreviation: 'OKC' },
    { game: '241103012', team: '25', year: 2004, reported: 'Seattle SuperSonics', franchise: 'Oklahoma City Thunder', abbreviation: 'OKC' },
    { game: '231029028', team: '17', year: 2003, reported: 'New Jersey Nets', franchise: 'Brooklyn Nets', abbreviation: 'BKN' },
    { game: '241103017', team: '17', year: 2004, reported: 'New Jersey Nets', franchise: 'Brooklyn Nets', abbreviation: 'BKN' },
    { game: '231029003', team: '3', year: 2003, reported: 'New Orleans Hornets', franchise: 'New Orleans Pelicans', abbreviation: 'NO' },
    { game: '241103003', team: '3', year: 2004, reported: 'New Orleans Hornets', franchise: 'New Orleans Pelicans', abbreviation: 'NO' },
  ]
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const fixture of historicalCases) {
      const parent = `/games/${fixture.game}#player-box-scores`
      const profile = `/players/espn/900000001?game=${fixture.game}&team=${fixture.team}`
      await page.goto(`${base}${parent}`)
      const name = page.locator('#player-box-scores table').getByRole('link', { name: 'QA Historical Guard', exact: true })
      assert.equal(await name.getAttribute('href'), profile)
      await name.focus()
      await page.keyboard.press('Enter')
      await page.getByRole('heading', { name: 'QA Historical Guard', exact: true }).waitFor()
      const reported = await page.getByText(/^Game-reported team ·/).textContent()
      assert.equal(reported, `Game-reported team · ${fixture.reported}`)
      assert(!reported.includes(fixture.franchise))
      const selectedGame = page.getByRole('region', { name: 'The selected game' })
      assert.equal(await selectedGame.getByRole('link').getAttribute('href'), parent)
      await selectedGame.getByText(new RegExp(`\\b${fixture.year}\\b`)).waitFor()
      assert.equal(await page.getByRole('link', { name: fixture.franchise, exact: true }).getAttribute('href'), `/teams/${fixture.abbreviation}`)
      await page.getByText('Score matchup uses normalized franchise codes.', { exact: true }).waitFor()
      await noOverflow(page)
      const violations = await accessibility(page)
      if (fixture.team === '25' && fixture.year === 2003) await page.screenshot({ path: `${out}/historical-fixture-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.waitForURL(`${base}${parent}`)
      await page.goForward()
      await page.waitForURL(`${base}${profile}`)
      await page.getByText(`Game-reported team · ${fixture.reported}`, { exact: true }).waitFor()
      results.historical.push({ width, ...fixture, canonicalLink: profile, gameReportedNameSeparated: true, franchiseLinkPreserved: true, keyboardAndBackForward: true, noOverflow: true, accessibility: violations })
    }
    for (const gameId of ['231031012', '231107025']) {
      await page.goto(`${base}/players/espn/900000001?game=${gameId}&team=25`)
      await page.getByText('Game-reported team · Unavailable', { exact: true }).waitFor()
      assert.equal(await page.getByRole('link', { name: 'Oklahoma City Thunder', exact: true }).getAttribute('href'), '/teams/OKC')
      await noOverflow(page)
      const violations = await accessibility(page)
      if (gameId === '231031012') await page.screenshot({ path: `${out}/historical-name-unavailable-${width}.png`, fullPage: true })
      results.historical.push({ width, game: gameId, missingGameName: true, nameInferredFromFranchise: false, noOverflow: true, accessibility: violations })
    }
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`2003/2004 historical names and fallbacks passed at ${width}px`)
  }
} finally {
  await browser.close()
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n')
}
