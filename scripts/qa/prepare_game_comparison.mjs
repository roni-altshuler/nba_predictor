// Reproducible browser-QA copy. Product routes and published artifacts are untouched.
import { access, cp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const copy = resolve(process.env.QA_COPY || '/tmp/nba-game-comparison-fixture')
if (!copy.startsWith('/tmp/')) throw new Error('QA_COPY must be a new directory under /tmp')
try {
  await access(copy)
  throw new Error(`Refusing to overwrite existing QA copy: ${copy}`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await cp(root, copy, { recursive: true, filter: path => {
  const parts = relative(root, path).split('/')
  return !parts.some(part => ['.git', 'node_modules', '.next'].includes(part) || part.endsWith('.tsbuildinfo'))
} })
await symlink(join(root, 'node_modules'), join(copy, 'node_modules'), 'dir')
const edit = async (path, transform) => {
  const target = join(copy, path)
  await writeFile(target, transform(await readFile(target, 'utf8')))
}
await edit('src/app/(app)/games/[id]/page.tsx', source => {
  const needle = '  const { id } = await params\n\n  const archived = getArchivedGame(id)'
  if (!source.includes(needle)) throw new Error('Game QA insertion point changed')
  return source.replace(needle, "  const { id } = await params\n  if (id === '401859967') await new Promise(resolve => setTimeout(resolve, 2200))\n\n  const archived = getArchivedGame(id)")
})
await edit('src/app/(app)/players/[provider]/[id]/page.tsx', source => source
  .replace("import { notFound } from 'next/navigation'", "import { notFound } from 'next/navigation'\nimport { existsSync } from 'node:fs'")
  .replace('  const { provider, id } = await params', "  const { provider, id } = await params\n  if (id === '900000098') await new Promise(resolve => setTimeout(resolve, 3000))\n  if (id === '900000099' && existsSync('/tmp/nba-comparison-qa-fail')) throw new Error('Controlled QA profile failure')"))
await edit('src/app/(app)/teams/[abbr]/page.tsx', source => source.replace('      </header>', '      </header>\n      <Link href="/players/espn/900000098?game=401859967&team=18" prefetch={false}>QA controlled profile loading</Link>\n      <Link href="/players/espn/900000099?game=401859967&team=18" prefetch={false}>QA controlled route error</Link>'))
await writeFile(join(copy, 'qa-unavailable-mode'), 'unavailable')
await writeFile(join(copy, 'qa-available-mode'), 'available')
console.log(`Prepared isolated browser-QA copy at ${copy}`)
