/**
 * Screenshot every route at desktop and mobile.
 *
 * Scrolls each page top-to-bottom before capturing so any scroll-triggered
 * reveal has fired — otherwise content below the fold captures blank.
 */
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3120'
const OUT = process.env.OUT || 'screenshots'
const ROUTES = process.env.ROUTES
  ? process.env.ROUTES.split(',')
  : ['/', '/season', '/games', '/seasons', '/seasons/2026', '/predict',
     '/ratings', '/teams/NY', '/accuracy', '/about']

mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', ...devices['iPhone 13'] },
]

const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const context = await browser.newContext(vp)
  const page = await context.newPage()
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let y = 0
        const step = () => {
          window.scrollTo(0, y)
          y += 400
          if (y < document.body.scrollHeight) setTimeout(step, 30)
          else { window.scrollTo(0, 0); setTimeout(resolve, 150) }
        }
        step()
      })
    })
    const slug = route === '/' ? 'home' : route.replace(/\//g, '-').slice(1)
    await page.screenshot({ path: `${OUT}/${slug}-${vp.name}.png`, fullPage: true })
    console.log(`  ✓ ${slug}-${vp.name}`)
  }
  await context.close()
}
await browser.close()
