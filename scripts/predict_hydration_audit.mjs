// Run after npm run build and next start:
// QA_BASE=http://127.0.0.1:3120 node scripts/predict_hydration_audit.mjs
// Cold production entries are essential: development and mocked navigation do
// not reproduce force-static rendering an empty query before client hydration.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { browserDiagnostics } from './qa/browser_diagnostics.mjs'

const base = process.env.QA_BASE || 'http://127.0.0.1:3120'
const out = process.env.QA_OUT || '/tmp/nba-predict-hydration'
const data = JSON.parse(await readFile('backend/data/history/matchups.json', 'utf8'))
const cases = [
  { query: '', home: 'ATL', away: 'BOS' },
  { query: '?home=PHI&away=CLE', home: 'PHI', away: 'CLE' },
  { query: '?home=phi&away=cle', home: 'PHI', away: 'CLE' },
  { query: '?home=UNKNOWN&away=UNKNOWN', home: 'ATL', away: 'BOS' },
  { query: '?home=PHI&away=PHI', home: 'PHI', away: 'ATL' },
  { query: '?home=PHI', home: 'PHI', away: 'ATL' },
  { query: '?away=CLE', home: 'ATL', away: 'CLE' },
  { query: '?home=PHI&home=BOS&away=CLE', home: 'PHI', away: 'CLE' },
]
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.QA_BROWSER || '/usr/bin/chromium' })
const report = { browser: browser.version(), basis: 'Cold local production entries; no retries. Published lookup probabilities unchanged. External CDN logos blocked.', rows: [] }
try {
  for (const width of [320, 390, 768, 1440]) for (const colorScheme of ['light', 'dark']) for (const [index, scenario] of cases.entries()) {
    const id = `${width}-${colorScheme}-${index}`
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, reducedMotion: 'no-preference' })
    await context.route('**://a.espncdn.com/**', route => route.abort())
    const page = await context.newPage()
    const diagnostics = await browserDiagnostics(page, `${out}/diagnostics`, id, { trace: false })
    const row = { id, width, colorScheme, ...scenario }
    report.rows.push(row)
    try {
      const response = await page.goto(`${base}/predict${scenario.query}`, { waitUntil: 'networkidle' })
      assert.equal(response.status(), 200)
      const home = page.getByRole('combobox', { name: 'Home team', exact: true })
      const away = page.getByRole('combobox', { name: 'Away team', exact: true })
      await home.waitFor()
      assert.equal(await home.inputValue(), scenario.home)
      assert.equal(await away.inputValue(), scenario.away)
      const forecast = data.matchups.find(item => item.home === scenario.home && item.away === scenario.away)
      assert.ok(forecast, 'Expected pairing must have a published forecast')
      await page.getByText(`${(100 * forecast.p_home).toFixed(1)}%`, { exact: true }).waitFor()
      if (index === 1) await page.screenshot({ path: `${out}/cold-${width}-${colorScheme}.png` })
      // Keyboard activation and reload must preserve the actual ordered pair.
      await page.getByRole('button', { name: 'Swap home and away' }).focus()
      await page.keyboard.press('Enter')
      assert.equal(await home.inputValue(), scenario.away)
      assert.equal(await away.inputValue(), scenario.home)
      assert.equal(new URL(page.url()).searchParams.get('home'), scenario.away)
      assert.equal(new URL(page.url()).searchParams.get('away'), scenario.home)
      await page.reload({ waitUntil: 'networkidle' })
      await home.waitFor()
      assert.equal(await home.inputValue(), scenario.away)
      assert.equal(await away.inputValue(), scenario.home)
      row.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      assert.equal(row.noHorizontalOverflow, true)
      row.coldPairAndPublishedChance = true
      row.keyboardSwapURLAndReload = true
    } catch (error) {
      row.failure = { message: error.message, stack: error.stack }
    }
    row.diagnostics = await diagnostics.finish()
    await writeFile(`${out}/partial.json`, JSON.stringify(report, null, 2) + '\n')
    await context.close()
    assert.equal(row.failure, undefined, `${id}: assertion failure`)
    assert.deepEqual(row.diagnostics.unexpected, [], `${id}: browser runtime or console error`)
  }
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(`Passed ${report.rows.length} cold query, keyboard-swap and reload cases.`)
} finally { await browser.close() }
