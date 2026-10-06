// Local browser QA against committed forecasts; no ingestion or model runs.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const base = process.env.QA_BASE || 'http://127.0.0.1:3120'
const out = process.env.QA_OUT || '/tmp/hardwood-slate'
await mkdir(out, { recursive: true })
const source = JSON.parse(await readFile('backend/data/predictions/game_forecasts.json', 'utf8'))
const game = source.games[0]
const dayOf = utc => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(utc))
const day = dayOf(game.date_utc)
const emptyDate = new Date(`${day}T12:00:00Z`)
emptyDate.setUTCDate(emptyDate.getUTCDate() - 1)
const emptyDay = emptyDate.toISOString().slice(0, 10)
const team = game.away.abbreviation
const teamGames = source.games.filter(g => [g.home.abbreviation, g.away.abbreviation].includes(team))
const nextTeamDay = teamGames.map(g => dayOf(g.date_utc)).filter(d => d > day).sort()[0]
assert(nextTeamDay, 'Needs another published slate for this franchise')
const browser = await chromium.launch({
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
})
const results = { source: source.generated_at, gameId: game.game_id, widths: [] }
const noOverflow = async (page, label) => assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label,
)
const ready = page => page.locator('[aria-label="Daily slate"][data-ready="true"]').waitFor()
const accessibility = async page => {
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })))
  assert.deepEqual(violations, [], 'Slate and matchup accessibility')
  return violations
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/games?date=${day}`)
    await ready(page)
    const slate = page.getByRole('region', { name: 'Daily slate' })
    assert.equal(await slate.getByRole('link').count(), source.games.filter(g => dayOf(g.date_utc) === day).length)
    await noOverflow(page, `Slate at ${width}`)
    const slateAccessibility = await accessibility(page)
    await page.screenshot({ path: `${out}/slate-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Today', exact: true }).click()
    assert.equal(await page.getByLabel('Game date', { exact: true }).inputValue(), dayOf(new Date().toISOString()))
    await page.goBack()
    await page.waitForFunction(d => document.querySelector('[aria-label="Game date"]').value === d, day)
    await page.getByRole('navigation', { name: 'Dates near selected day' }).getByRole('button').nth(4).click()
    assert.notEqual(await page.getByLabel('Game date', { exact: true }).inputValue(), day)
    await page.goBack()
    await page.waitForFunction(d => document.querySelector('[aria-label="Game date"]').value === d, day)
    await page.getByLabel('Game date', { exact: true }).fill(emptyDay)
    await page.getByRole('heading', { name: 'No published games in this view' }).waitFor()
    await page.getByRole('button', { name: 'Go to next published slate →' }).click()
    assert.equal(await page.getByLabel('Game date', { exact: true }).inputValue(), day)
    await page.getByLabel('Filter by franchise').selectOption(team)
    assert.equal(new URL(page.url()).searchParams.get('team'), team)
    await page.getByRole('button', { name: 'Next published slate', exact: true }).click()
    assert.equal(await page.getByLabel('Game date', { exact: true }).inputValue(), nextTeamDay)
    await page.getByRole('button', { name: 'Previous published slate', exact: true }).click()
    assert.equal(await page.getByLabel('Game date', { exact: true }).inputValue(), day)
    await page.goBack()
    await page.waitForFunction(d => document.querySelector('[aria-label="Game date"]').value === d, nextTeamDay)
    await page.goBack()
    await page.waitForFunction(d => document.querySelector('[aria-label="Game date"]').value === d, day)
    await page.goForward()
    await page.waitForFunction(d => document.querySelector('[aria-label="Game date"]').value === d, nextTeamDay)
    await page.goBack()
    await page.waitForFunction(d => document.querySelector('[aria-label="Game date"]').value === d, day)
    const gameLink = slate.getByRole('link', { name: new RegExp(`${game.away.name} at ${game.home.name}`) })
    await gameLink.focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(`**/games/${game.game_id}`)
    await page.getByRole('heading', { name: `${game.away.name} at ${game.home.name}` }).waitFor()
    const probabilityLabel = `${game.away.abbreviation} ${((1 - game.p_home) * 100).toFixed(1)}%, ${game.home.abbreviation} ${(game.p_home * 100).toFixed(1)}%`
    assert.equal(await page.getByRole('img', { name: probabilityLabel, exact: true }).count(), 1)
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor()
    await noOverflow(page, `Matchup at ${width}`)
    const matchupAccessibility = await accessibility(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `${out}/matchup-${width}.png`, fullPage: true })
    const entries = await page.evaluate(() => history.length)
    await page.getByRole('link', { name: 'Availability', exact: true }).click()
    assert.equal(await page.evaluate(() => document.activeElement.id), 'availability')
    assert.equal(await page.evaluate(() => history.length), entries)
    assert.equal(new URL(page.url()).hash, '#availability')
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(`**/games?date=${day}&team=${team}`)
    await ready(page)
    assert.equal(await page.getByLabel('Filter by franchise').inputValue(), team)
    await page.goForward()
    await page.getByRole('heading', { name: `${game.away.name} at ${game.home.name}` }).waitFor()
    assert.equal(new URL(page.url()).hash, '#availability')
    await page.goBack()
    await ready(page)
    await page.locator('summary').filter({ hasText: 'Full season calendar' }).click()
    await page.locator('[id^="week-"] a').first().waitFor()
    await noOverflow(page, `Expanded calendar at ${width}`)
    await page.goto(`${base}/games/unknown-slate-qa`)
    await page.getByText('Nothing lives at this address.', { exact: false }).waitFor()
    assert.equal(await page.getByRole('link', { name: 'Schedule', exact: true }).getAttribute('href'), '/games')
    await noOverflow(page, `Unknown game at ${width}`)
    assert.deepEqual(errors, [], `Unexpected browser errors at ${width}`)
    results.widths.push({ width, overflow: false, browserErrors: errors, slateAccessibility, matchupAccessibility, todayAndDateRail: true, previousAndNextSlates: true, dateAndTeamHistory: true, keyboardGameLink: true, sectionFocus: true, matchupBackAndForward: true, emptyRecovery: true, weeklyExpansion: true, unknownGameRecovery: true })
    await context.close()
    console.log(`Passed slate and matchup flows at ${width}px`)
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const response = await page.goto(`${base}/games/${game.game_id}`)
  await page.getByRole('link', { name: 'Daily slate', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Daily slate', exact: true }).getAttribute('href'), `/games?date=${day}`)
  const html = await response.text()
  const unrelatedIds = source.games.slice(1).filter(g => html.includes(g.game_id))
  assert.deepEqual(unrelatedIds, [], 'The matchup response must not serialize other forecasts')
  const flight = await context.request.get(`${base}/games/${game.game_id}`, { headers: { RSC: '1' } })
  const flightText = await flight.text()
  assert.match(flight.headers()['content-type'], /text\/x-component/)
  assert.deepEqual(source.games.slice(1).filter(g => flightText.includes(g.game_id)), [], 'The RSC response must not serialize other forecasts')
  results.serialization = { htmlBytes: Buffer.byteLength(html), rscBytes: Buffer.byteLength(flightText), unrelatedForecastIds: unrelatedIds.length, coldEasternParent: true }
  await context.close()

} finally {
  await browser.close()
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results, null, 2))
