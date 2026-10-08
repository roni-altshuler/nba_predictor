// Full journey in an isolated copy, with synthetic player responses and controlled boundaries.
import { access, cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const copy = resolve(process.env.QA_COPY || '/tmp/nba-theme-journey-fixture')
if (!copy.startsWith('/tmp/')) throw new Error('QA_COPY must be a new directory under /tmp')
try { await access(copy); throw new Error(`Refusing to overwrite ${copy}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
await cp(root, copy, { recursive: true, filter: path => !relative(root, path).split('/').some(part => ['.git', 'node_modules', '.next'].includes(part) || part.endsWith('.tsbuildinfo')) })
await symlink(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir')
const route = join(copy, 'src/app/(app)/qa-theme')
await mkdir(route, { recursive: true })
await writeFile(join(route, 'page.tsx'), `import { existsSync } from 'node:fs'
import GamePage from '../games/[id]/page'
export const dynamic = 'force-dynamic'
export default async function QaTheme() {
  await new Promise(resolve => setTimeout(resolve, 2500))
  if (existsSync('/tmp/nba-theme-qa-fail')) throw new Error('Controlled theme QA failure')
  return GamePage({ params: Promise.resolve({ id: '401859967' }) })
}
`)
await writeFile(join(route, 'loading.tsx'), "export { default } from '../games/[id]/loading'\n")
const team = join(copy, 'src/app/(app)/teams/[abbr]/page.tsx')
const source = await readFile(team, 'utf8')
if (!source.includes('      </header>')) throw new Error('Team QA insertion point changed')
await writeFile(team, source.replace('      </header>', '      </header>\n      <Link href="/qa-theme" prefetch={false}>QA controlled theme states</Link>'))
await writeFile(join(copy, 'qa-available-mode'), 'available')
await writeFile(join(copy, 'qa-unavailable-mode'), 'unavailable')
// Suppress only Next's development badge in controlled screenshots, not product errors.
const config = join(copy, 'next.config.js')
await writeFile(config, (await readFile(config, 'utf8')).replace('  reactStrictMode: true,', '  reactStrictMode: true,\n  devIndicators: false,'))
console.log(`Prepared isolated theme journey at ${copy}`)
