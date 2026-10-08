// A connected browser journey, with real artifacts and explicitly synthetic ESPN player lines.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'

const base = process.env.QA_BASE || 'http://127.0.0.1:3191'
const product = process.env.QA_PRODUCT_BASE || 'http://127.0.0.1:3192'
const out = process.env.QA_OUT || '/tmp/nba-theme-journey-qa'
const failFlag = '/tmp/nba-theme-qa-fail'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { auditedAt: new Date().toISOString(), chromium: browser.version(), baseCommit: '5bb550c43446ce24f594b8e6a85294a7294241b3', basis: 'Saved cloud Chromium. Connected production fixture journey: real committed team/forecast data; synthetic player lines through the existing ESPN-only preload. ESPN CDN logos deliberately unavailable; original abbreviation fallbacks checked after images settle. Product production server for source-unavailable and cold-paint checks. One isolated route/link for controlled boundaries.', journeys: [], coldPaint: [], product: [] }
const controlLogos = context => context.route('**://a.espncdn.com/**', route => route.abort())

const ready = page => page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === location.pathname)
const nav = async (page, href, width) => {
  if (width < 768 && !['/', '/lab', '/season', '/accuracy'].includes(href)) {
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.locator(`#mobile-more-sheet a[href="${href}"]`).click()
  } else {
    const shell = width < 768 ? page.locator('nav[aria-label="Primary"]') : page.locator('aside[aria-label="Primary"]')
    await shell.locator(`a[href="${href}"]`).first().click()
  }
  await page.waitForURL(url => url.pathname === href); await ready(page)
}
const dial = async (page, value, width) => {
  if (width < 768) await page.getByRole('button', { name: 'More', exact: true }).click()
  const shell = width < 768 ? page.locator('#mobile-more-sheet') : page.locator('aside')
  await shell.getByRole('button', { name: value, exact: true }).focus(); await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => localStorage.getItem('hardwood-ambient')), value)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.ambient), value)
  if (width < 768) await page.keyboard.press('Escape')
}
const snapshot = async (page, label, steps, capture = false) => {
  await page.locator('#main').waitFor()
  // Lazy images clipped inside a horizontal scroller may never request until
  // scrolled. Wait for requested images instead of waiting for every lazy img.
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => document.title.trim().length > 0)
  // Let React commit the image-error fallback before axe measures its colours.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  const state = await page.evaluate(async () => {
    const root = getComputedStyle(document.documentElement)
    const cards = [...document.querySelectorAll('.card')].filter(e => e.getBoundingClientRect().width)
    const heading = document.querySelector('h1')
    return {
      path: location.pathname + location.search, title: document.title, ambient: document.documentElement.dataset.ambient,
      background: getComputedStyle(document.body).backgroundColor, scheme: root.colorScheme,
      tokens: Object.fromEntries(['--card-bg', '--logo-plate', '--text-primary', '--accent-brand'].map(key => [key, root.getPropertyValue(key).trim()])),
      cardBackgrounds: [...new Set(cards.map(e => getComputedStyle(e).backgroundColor))],
      nativeSchemes: [...new Set([...document.querySelectorAll('select,input')].map(e => getComputedStyle(e).colorScheme))],
      headingFont: heading ? getComputedStyle(heading).fontFamily : null,
      headingTransform: heading ? getComputedStyle(heading).textTransform : null,
      overflow: document.documentElement.scrollWidth > innerWidth,
      violations: (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    }
  })
  steps.push({ label, ...state })
  await writeFile(`${out}/partial.json`, JSON.stringify(report, null, 2))
  assert.equal(state.background, 'rgb(12, 7, 5)')
  assert.equal(state.scheme, 'dark')
  assert.deepEqual(state.tokens, { '--card-bg': '#17100a', '--logo-plate': '#fdf6ee', '--text-primary': '#fdf6ee', '--accent-brand': '#e2682a' })
  assert(state.cardBackgrounds.every(value => ['rgb(23, 16, 10)', 'rgb(33, 23, 17)'].includes(value)))
  assert(state.nativeSchemes.every(value => value === 'dark'))
  if (state.headingFont) { assert.match(state.headingFont, /Arial/); assert.equal(state.headingTransform, 'uppercase') }
  assert.equal(state.overflow, false); assert.deepEqual(state.violations, [])
  if (capture) await page.screenshot({ path: `${out}/${label}-${page.viewportSize().width}.png` })
}

try {
  const journeys = process.env.QA_JOURNEYS ? JSON.parse(process.env.QA_JOURNEYS) : [[320, 'light'], [390, 'dark'], [1440, 'light'], [1440, 'dark']]
  for (const [width, system] of journeys) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: system, reducedMotion: 'reduce' })
    await controlLogos(context)
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const journey = { width, system, steps: [], unexpectedErrors: errors }
    report.journeys.push(journey)
    await page.goto(base); await ready(page)
    await dial(page, 'vivid', width); await dial(page, 'off', width)
    await snapshot(page, 'home', journey.steps, true)
    await page.locator('#main').getByRole('link', { name: 'All games', exact: true }).click(); await ready(page)
    await snapshot(page, 'slate', journey.steps, true)
    await page.getByLabel('Game date', { exact: true }).fill('2026-10-21')
    await page.getByLabel('Filter by franchise', { exact: true }).selectOption('BOS')
    await page.getByRole('heading', { name: 'No published games in this view', exact: true }).waitFor()
    await snapshot(page, 'empty-slate', journey.steps, true)
    await page.getByLabel('Game date', { exact: true }).fill('2026-10-20')
    await page.locator('#main a[href="/games/401909088"]').click(); await ready(page)
    await snapshot(page, 'upcoming', journey.steps)
    await page.getByRole('link', { name: 'Shooting context', exact: true }).click()
    await snapshot(page, 'empty-shooting', journey.steps)
    await page.getByRole('button', { name: 'View prior-season reference', exact: true }).click()
    await page.getByLabel('Recent games', { exact: true }).selectOption('5')
    await snapshot(page, 'prior-shooting', journey.steps, true)
    await page.reload(); await ready(page)
    await page.locator('#shooting-context[data-ready="true"]').waitFor()
    assert.equal(await page.getByLabel('Season sample', { exact: true }).inputValue(), '2026')
    assert.equal(await page.getByLabel('Recent games', { exact: true }).inputValue(), '5')
    await nav(page, '/', width)
    await page.locator('#main a[href="/teams/NY"]').first().click(); await ready(page)
    await snapshot(page, 'team', journey.steps)
    await page.locator('#main a[href="/games/401859967#player-box-scores"]').first().click(); await ready(page)
    await page.locator('#game-line-comparison[data-ready="true"]').waitFor()
    await page.locator('#game-line-comparison').scrollIntoViewIfNeeded()
    await snapshot(page, 'archived-comparison', journey.steps, true)
    await page.getByLabel('First player', { exact: true }).selectOption('18:espn:900000002')
    await page.getByRole('button', { name: 'Swap players', exact: true }).click()
    const returnUrl = page.url()
    await page.getByRole('link', { name: 'Open QA Forward game profile', exact: true }).click(); await ready(page)
    await page.getByRole('heading', { name: 'QA Forward', exact: true }).waitFor()
    await snapshot(page, 'player', journey.steps, true)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(returnUrl); await ready(page)
    assert.equal(await page.getByLabel('First player', { exact: true }).inputValue(), '24:espn:900000003')
    await page.goForward(); await ready(page); await page.getByRole('heading', { name: 'QA Forward', exact: true }).waitFor()
    await page.goBack(); await ready(page)
    await snapshot(page, 'comparison-return', journey.steps)
    await nav(page, '/predict', width); await snapshot(page, 'head-to-head', journey.steps, true)
    await nav(page, '/lab', width); await snapshot(page, 'lab', journey.steps)
    await nav(page, '/ratings', width); await snapshot(page, 'ratings', journey.steps)
    await page.locator('#main a[href="/about#regression"]').click(); await ready(page)
    await snapshot(page, 'methodology', journey.steps)
    await nav(page, '/accuracy', width); await snapshot(page, 'evidence', journey.steps, true)
    const comparisonTable = page.getByRole('region', { name: 'Closing-line forecast comparison', exact: true })
    await comparisonTable.focus(); await page.keyboard.press('ArrowRight')
    assert.equal(await comparisonTable.evaluate(element => element === document.activeElement), true)
    await nav(page, '/seasons', width); await snapshot(page, 'season-list', journey.steps)
    await page.locator('#main a[href="/seasons/2026"]').first().click(); await ready(page)
    await snapshot(page, 'archive-season', journey.steps, true)
    await page.locator('#main a[href="/seasons/2026/series/18v24"]').first().click(); await ready(page)
    await snapshot(page, 'archive-series', journey.steps)
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await ready(page)
    await page.locator('#main a[href="/seasons/2026/games"]').first().click(); await ready(page)
    await snapshot(page, 'archive-games', journey.steps)
    await nav(page, '/season', width); await snapshot(page, 'current-season', journey.steps)
    await nav(page, '/bracket', width); await snapshot(page, 'bracket', journey.steps)
    await nav(page, '/allstar', width); await snapshot(page, 'allstar', journey.steps)
    await nav(page, '/upsets', width); await snapshot(page, 'upsets', journey.steps)
    await nav(page, '/preview', width); await snapshot(page, 'season-preview', journey.steps)
    await nav(page, '/playoffs', width); await snapshot(page, 'playoff-picture', journey.steps)
    await page.goto(`${base}/players/espn/900000001`); await ready(page)
    await snapshot(page, 'empty-profile', journey.steps)
    await page.goto(`${base}/games/unknown-theme`); await ready(page)
    await snapshot(page, 'not-found', journey.steps)
    await page.getByRole('link', { name: 'Schedule', exact: true }).click(); await ready(page)
    await snapshot(page, 'not-found-recovery', journey.steps)
    assert(journey.steps.every(step => step.ambient === 'off'))
    assert.deepEqual(errors, [])

    await nav(page, '/', width)
    await page.locator('#main a[href="/teams/NY"]').first().click(); await ready(page)
    await writeFile(failFlag, 'controlled error')
    await page.getByRole('link', { name: 'QA controlled theme states', exact: true }).click()
    await page.getByLabel('Loading game', { exact: true }).waitFor()
    await snapshot(page, 'loading', journey.steps, true)
    await page.getByRole('heading', { name: "This page couldn't load", exact: true }).waitFor()
    await snapshot(page, 'error', journey.steps, true)
    await unlink(failFlag)
    await page.getByRole('button', { name: 'Try again', exact: true }).focus(); await page.keyboard.press('Enter')
    await page.locator('#shooting-context[data-ready="true"]').waitFor()
    await snapshot(page, 'retry-recovery', journey.steps)
    // Production redacts the deliberately thrown server error. Do not hide
    // hydration or client failures that occur during retry/recovery.
    const controlled = message => /Server Components render|Controlled theme QA failure/.test(message)
    journey.controlledErrorMessages = errors.filter(controlled)
    journey.unexpectedErrors = errors.filter(message => !controlled(message))
    assert.deepEqual(journey.unexpectedErrors, [])
    await context.close(); console.log(`Full theme journey passed: ${width}px, system ${system}`)
  }

  for (const preference of ['off', 'vivid']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' })
    await controlLogos(context)
    await context.addInitScript(value => {
      localStorage.setItem('hardwood-ambient', value)
      window.themeFrames = []
      const sample = () => {
        if (document.body) window.themeFrames.push({ background: getComputedStyle(document.body).backgroundColor, ambient: document.documentElement.dataset.ambient })
        if (window.themeFrames.length < 120) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }, preference)
    await context.route('**/_next/static/**/*.js', async route => { await new Promise(resolve => setTimeout(resolve, 1600)); await route.continue() })
    const page = await context.newPage()
    await page.goto(product, { waitUntil: 'commit' }); await page.locator('#main').waitFor()
    const initial = await page.evaluate(value => {
      const button = document.querySelector(`aside [data-ambient-option="${value}"]`)
      return { ambient: document.documentElement.dataset.ambient, selectedBackground: getComputedStyle(button).backgroundColor,
        pressed: [...document.querySelectorAll('aside button[aria-pressed="true"]')].map(b => b.textContent), busy: document.querySelector('aside [role="group"]')?.getAttribute('aria-busy') }
    }, preference)
    assert.equal(initial.ambient, preference); assert.equal(initial.selectedBackground, 'rgb(33, 23, 17)')
    assert.deepEqual(initial.pressed, []); assert.equal(initial.busy, 'true')
    await page.waitForFunction(value => document.querySelector(`aside [data-ambient-option="${value}"]`)?.getAttribute('aria-pressed') === 'true', preference)
    const frames = await page.evaluate(() => window.themeFrames)
    assert(frames.length > 0); assert(frames.every(frame => frame.background === 'rgb(12, 7, 5)' && frame.ambient === preference))
    report.coldPaint.push({ preference, initial, sampledFrames: frames.length, stableBackgroundAndPreference: true })
    await page.screenshot({ path: `${out}/cold-${preference}-1440.png` })
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' })
  await controlLogos(context)
  const page = await context.newPage()
  await page.goto(`${product}/games/401859967`); await ready(page)
  await page.getByRole('heading', { name: 'No player box score', exact: true }).waitFor()
  await snapshot(page, 'provider-unavailable', report.product, true)
  await context.close()

  const recovery = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' })
  await controlLogos(recovery)
  await recovery.addInitScript(() => {
    localStorage.setItem('hardwood-ambient', 'off')
    const observer = new MutationObserver(() => {
      if (document.documentElement?.hasAttribute('data-ambient')) {
        observer.disconnect()
        document.documentElement.removeAttribute('data-ambient')
      }
    })
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ambient'] })
  })
  const recovered = await recovery.newPage(), recoveryErrors = []
  recovered.on('pageerror', error => recoveryErrors.push(error.message))
  await recovered.goto(`${product}/players/espn/900000001`); await ready(recovered)
  await recovered.waitForFunction(() => document.documentElement.dataset.ambient === 'off' && document.querySelector('aside [data-ambient-option="off"]')?.getAttribute('aria-pressed') === 'true')
  assert.equal(await recovered.evaluate(() => localStorage.getItem('hardwood-ambient')), 'off')
  assert.deepEqual(recoveryErrors, [])
  report.preferenceRecovery = { controlledMissingRootAttribute: true, restoredPreference: 'off', storageUnchanged: true, unexpectedErrors: recoveryErrors }
  await recovery.close()
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
} finally { await unlink(failFlag).catch(() => {}); await browser.close() }
