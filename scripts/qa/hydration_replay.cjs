// Deterministic probe for the exact PageTransition component and Next's renderer.
// It runs only in a child process; ordinary Jest components use package React 18.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const Module = require('node:module')
const { dirname, join } = require('node:path')

const root = process.cwd()
const route = '/games/401909088?scoutSeason=2026&scoutWindow=5'
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'next/navigation') return { usePathname: () => route.split('?')[0] }
  if (request === 'react/jsx-runtime') request = 'next/dist/compiled/react/jsx-runtime'
  if (request === 'next/dist/compiled/scheduler') request = 'next/dist/compiled/scheduler/unstable_mock'
  return originalLoad.call(this, request, parent, isMain)
}

const React = require('next/dist/compiled/react')
const Scheduler = require('next/dist/compiled/scheduler/unstable_mock')
const { renderToString } = require('next/dist/compiled/react-dom/server')
const { JSDOM } = require('jsdom')
const ts = require('typescript')
const filename = join(root, 'src/components/motion/PageTransition.tsx')
const source = readFileSync(filename, 'utf8')
const componentModule = new Module(filename, module)
componentModule.filename = filename
componentModule.paths = Module._nodeModulePaths(dirname(filename))
// Compile the actual component: removing its repair must make the test fail.
componentModule._compile(ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  },
}).outputText, filename)
const { PageTransition } = componentModule.exports
const h = React.createElement
const content = h(React.Suspense, { fallback: null },
  h('section', { id: 'game-content' }, 'Same matchup content'))
const app = child => h('html', { lang: 'en' }, h('head', null),
  h('body', null, h('a', { href: '#main' }, 'Skip to main content'),
    h('main', { id: 'main' }, h(PageTransition, null, child))))
const serverMarkup = renderToString(app(content))
const dom = new JSDOM(serverMarkup, { url: 'http://localhost' + route })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text',
  'Comment', 'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver', 'HTMLIFrameElement']) {
  global[key] = dom.window[key]
}
const wrapper = document.querySelector('.page-enter')
const leaf = document.querySelector('#game-content')
if (process.argv.includes('--different-server-text')) leaf.textContent = 'Unexpected server text'
const errors = [], listeners = []
// Flight-compatible lazy node. Fulfill during the scheduler's pinned hydration
// yield, so React replays the suspended work instead of unwinding from the root.
const chunk = { status: 'pending', value: null, then(resolve) { listeners.push(resolve) } }
const lazy = {
  $$typeof: Symbol.for('react.lazy'), _payload: chunk,
  _init(payload) {
    Scheduler.log('read:' + payload.status)
    if (payload.status === 'fulfilled') return payload.value
    throw payload
  },
}
const { hydrateRoot } = require('next/dist/compiled/react-dom/client')
Module._load = originalLoad

async function run() {
  React.startTransition(() => hydrateRoot(document, app(lazy), {
    onRecoverableError(error) { errors.push({ message: error.message, stack: error.stack }) },
  }))
  await Promise.resolve()
  Scheduler.unstable_flushNumberOfYields(1)
  const pendingLog = Scheduler.unstable_clearLog()
  assert.deepEqual(pendingLog, ['read:pending'])
  chunk.status = 'fulfilled'
  chunk.value = content
  listeners.forEach(resolve => resolve(content))
  Scheduler.unstable_flushAllWithoutAsserting()
  await Promise.resolve()
  Scheduler.unstable_flushAllWithoutAsserting()
  const settledLog = Scheduler.unstable_clearLog()
  process.stdout.write(JSON.stringify({
    react: React.version,
    matchingMarkup: serverMarkup === renderToString(app(content)),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    route, pendingLog, settledLog, errors,
    wrapperReused: document.querySelector('.page-enter') === wrapper,
    contentReused: document.querySelector('#game-content') === leaf,
  }, null, 2) + '\n')
  dom.window.close()
}
run().catch(error => { console.error(error); process.exitCode = 1 })
