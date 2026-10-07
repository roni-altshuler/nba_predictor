// Actual Chromium interaction QA using isolated synthetic ESPN responses.
// Supply QA_BASE (fixture server) and QA_UNAVAILABLE_BASE (unmodified app, ESPN 503).
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, unlink, writeFile } from 'node:fs/promises'

const base = process.env.QA_BASE || 'http://127.0.0.1:3160'
const unavailable = process.env.QA_UNAVAILABLE_BASE || 'http://127.0.0.1:3161'
const out = process.env.QA_OUT || '/tmp/nba-game-comparison-qa'
const failFlag = '/tmp/nba-comparison-qa-fail'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const results = { basis: 'Synthetic player lines; real committed dated game context. Unmodified production build for source-outage cases.', widths: [], states: [] }
const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
const axe = async page => {
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector('#main'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))
  assert.deepEqual(violations, [])
}
const ready = page => page.locator('#game-line-comparison[data-ready="true"]').waitFor()
const keys = { guard: '18:espn:900000001', reserve: '18:espn:900000002', forward: '24:espn:900000003' }
const values = async page => [await page.getByLabel('First player', { exact: true }).inputValue(), await page.getByLabel('Second player', { exact: true }).inputValue()]
const pair = async (page, left, right) => assert.deepEqual(await values(page), [left, right])
const componentShot = async (page, element, path, width) => {
  // Fit the entire card for an artifact without the fixed mobile nav masking it.
  const height = Math.max(1000, Math.ceil((await element.boundingBox()).height) + 200)
  await page.setViewportSize({ width, height })
  await element.scrollIntoViewIfNeeded()
  await element.screenshot({ path })
  await page.setViewportSize({ width, height: 1000 })
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []; const portraits = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/headshot|\/athletes\//i.test(request.url())) portraits.push(request.url()) })
    await page.goto(`${base}/games/401859967#game-line-comparison`)
    await ready(page)
    await pair(page, keys.guard, keys.forward)
    const region = page.getByRole('region', { name: 'Compare game lines' })
    assert.match(await region.innerText(), /Final · Jun 13, 2026 ET/i)
    assert.match(await region.innerText(), /Sample: 1 game per player/)
    const first = page.getByLabel('First player', { exact: true })
    await first.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await pair(page, keys.reserve, keys.forward)
    await region.getByText('Did not play · QA DNP reason', { exact: true }).waitFor()
    assert.equal(await first.evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
    const dnpRows = await region.getByRole('table').getByRole('row').all()
    for (const row of dnpRows.slice(1)) assert.equal(await row.getByRole('cell').first().innerText(), '—')
    await page.goBack()
    await pair(page, keys.guard, keys.forward)
    await page.goForward()
    await pair(page, keys.reserve, keys.forward)
    const swap = region.getByRole('button', { name: 'Swap players', exact: true })
    await swap.focus(); await page.keyboard.press('Enter')
    await pair(page, keys.forward, keys.reserve)
    assert.equal(await swap.evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
    await page.reload(); await ready(page)
    await pair(page, keys.forward, keys.reserve)
    await page.goBack(); await pair(page, keys.reserve, keys.forward)
    await page.goForward(); await pair(page, keys.forward, keys.reserve)

    // Repeated selection/swap must update columns and retain all published lines.
    for (let i = 0; i < 3; i++) await swap.click()
    await pair(page, keys.reserve, keys.forward)
    await first.selectOption(keys.guard)
    await pair(page, keys.guard, keys.forward)
    assert.equal(await region.getByRole('columnheader', { name: 'QA Guard', exact: true }).count(), 1)
    assert.equal(await region.getByRole('columnheader', { name: 'QA Forward', exact: true }).count(), 1)
    assert.equal(await page.locator('#player-box-scores > section:not(#game-line-comparison) table').count(), 2)
    await noOverflow(page); await axe(page)
    assert.equal(await region.locator('img').count(), 0)
    assert.equal(await region.evaluate(element => element.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 0)
    await region.scrollIntoViewIfNeeded()
    await componentShot(page, region, `${out}/comparison-${width}.png`, width)
    await page.screenshot({ path: `${out}/comparison-page-${width}.png` })

    // Existing provider-qualified profile and contextual Back preserve pairing.
    const beforeProfile = page.url()
    await region.getByRole('link', { name: 'Open QA Forward game profile', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'QA Forward', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(beforeProfile); await ready(page)
    await pair(page, keys.guard, keys.forward)
    await page.goForward()
    await page.getByRole('heading', { name: 'QA Forward', exact: true }).waitFor()
    await page.goBack(); await ready(page)
    await pair(page, keys.guard, keys.forward)

    // Historical supplied team names, without normalization from today's teams.
    await page.goto(`${base}/games/231030025#game-line-comparison`); await ready(page)
    const history = page.getByRole('region', { name: 'Compare game lines' })
    assert.match(await history.innerText(), /Seattle SuperSonics/)
    assert.doesNotMatch(await history.innerText(), /Oklahoma City Thunder/)
    assert.match(await history.innerText(), /2003 ET/)
    await noOverflow(page); await axe(page)

    // No usable provider identities: controls stay absent, original line remains.
    await page.goto(`${base}/games/401859966#game-line-comparison`); await ready(page)
    await page.getByRole('status').getByText(/fewer than two players/).waitFor()
    assert.equal(await page.getByRole('combobox').count(), 0)
    assert.equal(await page.locator('#player-box-scores table').getByText('QA Anonymous', { exact: true }).count(), 1)
    await noOverflow(page); await axe(page)
    await componentShot(page, page.locator('#game-line-comparison'), `${out}/comparison-empty-${width}.png`, width)
    assert.deepEqual(errors, []); assert.deepEqual(portraits, [])
    results.widths.push({ width, nativeKeyboardSelectionAndSwap: true, focusVisible: true, repeatedSelection: true, shareReloadBackForward: true, profileBackForward: true, historicalReportedTeam: true, missingStatAndDnp: true, emptyIdentityFallback: true, reducedMotion: true, horizontalOverflow: false, axeViolations: [], portraitRequests: portraits, browserErrors: errors })
    await context.close()
    console.log(`Comparison flows passed at ${width}px`)
  }

  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto(`${unavailable}/games/401859967#player-box-scores`)
    await page.getByRole('heading', { name: 'No player box score', exact: true }).waitFor()
    assert.equal(await page.locator('#game-line-comparison').count(), 0)
    assert.equal(await page.getByText('QA Guard', { exact: true }).count(), 0)
    await noOverflow(page); await axe(page)
    await page.locator('#player-box-scores').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${out}/comparison-source-unavailable-${width}.png` })
    results.states.push({ width, source503: true, noInventedLines: true, resultStillAvailable: true, axeViolations: [], horizontalOverflow: false })
    await context.close()
  }

  // Reserved local flag lives only in the isolated QA source copy.
  {
    const context = await browser.newContext({ viewport: { width: 320, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await writeFile(failFlag, 'fail')
    await page.goto(`${base}/teams/NY`)
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === '/teams/NY')
    await page.getByRole('link', { name: 'QA controlled route error', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: "This page couldn't load", exact: true }).waitFor()
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await noOverflow(page); await axe(page)
      await page.screenshot({ path: `${out}/comparison-error-${width}.png` })
    }
    await unlink(failFlag)
    await page.getByRole('button', { name: 'Try again', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
      await noOverflow(page)
      results.states.push({ width, controlledRouteError: true, keyboardRetryInitiatedAtWidth: 320, recoveryVisible: true, axeViolations: [], horizontalOverflow: false })
    }
    await context.close()
  }

  // Opening a profile is asynchronous; comparison selections are synchronous.
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto(`${base}/teams/NY`)
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === '/teams/NY')
    await page.getByRole('link', { name: 'QA controlled profile loading', exact: true }).click()
    const loading = page.getByLabel('Loading player profile', { exact: true })
    await loading.waitFor()
    assert.match(await loading.innerText(), /Loading player game line/)
    await noOverflow(page)
    assert.equal(await loading.locator('.skeleton-shimmer').first().evaluate(element => getComputedStyle(element, '::after').animationName), 'none')
    await page.screenshot({ path: `${out}/comparison-loading-${width}.png` })
    await page.getByRole('heading', { name: 'Player profile unavailable', exact: true }).waitFor()
    results.states.push({ width, actualProfileRouteLoading: true, reducedMotionSkeleton: true, resolvesToExplicitProfileUnavailable: true, horizontalOverflow: false })
    await context.close()
  }
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n')
} finally {
  await unlink(failFlag).catch(() => {})
  await browser.close()
}
