// Diagnostic repetitions retain every error and failed case; there is no retry-until-pass.
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { browserDiagnostics } from './qa/browser_diagnostics.mjs'

const out = process.env.QA_OUT || '/tmp/nba-hydration-investigation/repeats'
const builds = process.env.QA_BUILDS ? JSON.parse(process.env.QA_BUILDS) : [
  { name: 'baseline', base: 'http://127.0.0.1:4290', source: '5bb550c43446ce24f594b8e6a85294a7294241b3', reader: 'synthetic-available' },
  { name: 'pre-recovery', base: 'http://127.0.0.1:4295', source: 'e64f511 with only preference-recovery and SVG-arrow edits removed; reconstructed, not original built chunks', reader: 'synthetic-available' },
  { name: 'final-product', base: 'http://127.0.0.1:4291', source: 'e64f5112b82a4a7cc6c872757460bec090e9c0e5', reader: 'controlled-503' },
]
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { startedAt: new Date().toISOString(), browser: browser.version(), basis: 'Saved cloud, production builds. New browser context per case. No automatic retries. All page/console errors, stacks, raw document responses and timeline traces retained. CDN logos aborted consistently.', cases: [] }
let scenarios = []
for (const system of ['dark', 'light']) for (const preference of ['soft', 'off', 'vivid']) for (let repeat = 1; repeat <= 3; repeat++) scenarios.push({ kind: 'cold', system, preference, repeat, jsDelay: 0, injection: 'none', trace: repeat !== 1 })
for (const injection of ['none', 'at-ready', 'early-probe']) for (let repeat = 1; repeat <= 3; repeat++) scenarios.push({ kind: 'navigation', system: 'dark', preference: 'off', repeat, jsDelay: injection === 'early-probe' ? 600 : 0, injection, trace: repeat !== 1 })
for (const jsDelay of [80, 600, 1600]) for (let repeat = 1; repeat <= 2; repeat++) scenarios.push({ kind: 'cold', system: 'dark', preference: 'off', repeat, jsDelay, injection: 'none', trace: true })
if (process.env.QA_SCENARIOS) scenarios = JSON.parse(process.env.QA_SCENARIOS)
const destination = async (page, base, path, heading) => {
  await page.waitForURL(url => url.origin === new URL(base).origin && url.pathname === path)
  await page.locator('#main').getByRole('heading', { name: heading, exact: true }).waitFor()
}
const injectAxe = async page => {
  page.qaDiagnostics.mark('axe-script-insertion')
  await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })
  page.qaDiagnostics.mark('axe-scan')
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))
}
try {
  for (const build of builds) {
    for (const scenario of scenarios) {
      const id = `${build.name}-${scenario.kind}-${scenario.system}-${scenario.preference}-${scenario.injection}-${scenario.jsDelay}-${scenario.repeat}`
      const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, colorScheme: scenario.system, reducedMotion: 'reduce' })
      await context.route('**://a.espncdn.com/**', route => route.abort())
      if (scenario.kind === 'cold') await context.addInitScript(value => localStorage.setItem('hardwood-ambient', value), scenario.preference)
      if (scenario.jsDelay) await context.route('**/_next/static/**/*.js', async route => { await new Promise(resolve => setTimeout(resolve, scenario.jsDelay)); await route.continue() })
      const page = await context.newPage(), diagnostics = await browserDiagnostics(page, `${out}/raw`, id, { trace: scenario.trace })
      page.qaDiagnostics = diagnostics
      const result = { id, build, scenario, startedAt: new Date().toISOString(), harnessError: null }
      report.cases.push(result)
      try {
        if (scenario.kind === 'navigation') {
          diagnostics.mark('home-ui-preference')
          await page.goto(build.base)
          await destination(page, build.base, '/', 'Your front row to the forecast.')
          // Visible server markup alone does not mean the menu accepts input yet.
          await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === '/' && document.querySelector('[data-ambient-option="soft"]')?.closest('[role="group"]')?.getAttribute('aria-busy') !== 'true')
          await page.getByRole('button', { name: 'More', exact: true }).click()
          for (const choice of ['vivid', 'off']) {
            await page.locator('#mobile-more-sheet').getByRole('button', { name: choice, exact: true }).focus(); await page.keyboard.press('Enter')
          }
          await page.keyboard.press('Escape')
          if (scenario.injection === 'at-ready') await injectAxe(page)
          await page.getByRole('button', { name: 'More', exact: true }).click()
          await page.locator('#mobile-more-sheet a[href="/playoffs"]').click()
          await destination(page, build.base, '/playoffs', 'Playoff picture')
          if (scenario.injection === 'at-ready') await injectAxe(page)
          await diagnostics.checkpoint('before-hard-profile-navigation')
        }
        diagnostics.mark('hard-empty-profile')
        await page.goto(`${build.base}/players/espn/900000001`, { waitUntil: scenario.injection === 'early-probe' ? 'commit' : 'load' })
        if (scenario.injection === 'early-probe') {
          await page.locator('#main').waitFor()
          // A mechanism probe, explicitly earlier than the original ready/axe timing.
          await injectAxe(page)
        }
        await destination(page, build.base, '/players/espn/900000001', 'Player profile unavailable')
        await page.waitForFunction(() => document.readyState === 'complete' && document.title.trim().length > 0 && JSON.parse(sessionStorage.getItem('hardwood.navstack') || '[]').at(-1) === location.pathname)
        if (scenario.injection === 'at-ready') result.axe = await injectAxe(page)
        // Observe two seconds after the destination is rendered; record failures rather than retrying.
        await page.evaluate(() => new Promise(resolve => { let frames = 0; const tick = () => ++frames >= 120 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick) }))
        result.state = await diagnostics.checkpoint('settled-empty-profile')
        result.preferenceRetained = result.state.ambient === scenario.preference && result.state.storedAmbient === scenario.preference
        result.heading = await page.locator('#main h1').textContent()
      } catch (error) { result.harnessError = { message: error.message, stack: error.stack } }
      result.diagnostics = await diagnostics.finish()
      result.finishedAt = new Date().toISOString()
      await writeFile(`${out}/partial.json`, JSON.stringify(report, null, 2) + '\n')
      await context.close()
      console.log(`${id}: errors=${result.diagnostics.unexpected.length}, preference=${result.preferenceRetained}, harness=${!!result.harnessError}`)
    }
  }
  report.finishedAt = new Date().toISOString()
  report.summary = builds.map(build => {
    const cases = report.cases.filter(item => item.build.name === build.name)
    return { build: build.name, cases: cases.length, unexpectedErrorCases: cases.filter(item => item.diagnostics.unexpected.length).map(item => item.id), hydrationErrorCases: cases.filter(item => item.diagnostics.unexpected.some(event => /#418|hydration/i.test(event.message))).map(item => item.id), lostPreferenceCases: cases.filter(item => item.preferenceRetained === false).map(item => item.id), harnessFailures: cases.filter(item => item.harnessError).map(item => item.id) }
  })
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report.summary, null, 2))
} finally { await browser.close() }
