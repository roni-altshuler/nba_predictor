/**
 * Generate the full Hardwood icon set from the brand SVG sources.
 *
 * Sources (single source of truth):
 *   public/brand/icon-maskable.svg → full-bleed mark (PWA + apple-touch)
 *   public/favicon.svg             → rounded-plate mark (browser PNG favicons)
 *   public/brand/og-default.svg    → 1200×630 social / GitHub preview card
 *
 * Outputs (committed, served as static assets):
 *   public/icons/icon-{72..512}.png      manifest, maskable
 *   public/favicon-{16,32,48}.png        browser tab
 *   public/favicon.ico                   legacy + Chrome's fallback probe
 *   public/apple-touch-icon.png          180×180, iOS home screen
 *   public/brand/og-default.png          1200×630, OpenGraph / Twitter
 *
 * Run:  node scripts/generate-icons.mjs   (or: npm run icons)
 *
 * Re-run whenever a brand SVG changes so the rasterised assets stay in sync.
 * They are committed rather than generated at build time because Vercel's
 * build should not depend on a native image toolchain resolving.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const p = (...segs) => path.join(root, ...segs)

mkdirSync(p('public/icons'), { recursive: true })

const MASKABLE = readFileSync(p('public/brand/icon-maskable.svg'))
const FAVICON = readFileSync(p('public/favicon.svg'))
const OG = readFileSync(p('public/brand/og-default.svg'))

const PWA_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

// density 384 so the rasteriser supersamples the vector before downscaling;
// at the default 72 the 16px favicon's seam lines alias into mush.
async function render(svg, size, out) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(p(out))
  console.log(`  ✓ ${out} (${size}×${size})`)
}

async function main() {
  console.log('PWA / maskable icons')
  for (const size of PWA_SIZES) {
    await render(MASKABLE, size, `public/icons/icon-${size}x${size}.png`)
  }

  console.log('Apple touch icon')
  await render(MASKABLE, 180, 'public/apple-touch-icon.png')

  console.log('Browser favicons')
  for (const size of [16, 32, 48]) {
    await render(FAVICON, size, `public/favicon-${size}.png`)
  }

  // Chrome asks for /favicon.ico before it reads the <link> tags, so a
  // missing one costs a 404 on every cold load even when the SVG is
  // declared. A single 32px frame is enough for every modern browser.
  console.log('favicon.ico')
  await sharp(FAVICON, { density: 384 })
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFormat('png')
    .toFile(p('public/favicon.ico'))
  console.log('  ✓ public/favicon.ico (32×32)')

  console.log('OpenGraph card')
  await sharp(OG, { density: 192 })
    .resize(1200, 630, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toFile(p('public/brand/og-default.png'))
  console.log('  ✓ public/brand/og-default.png (1200×630)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
