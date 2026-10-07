// Synthetic comparison QA only, layered over the existing profile fixture.
// Run in an isolated /tmp copy. No ESPN request or published artifact is written.
require('./player_profile_fixture.cjs')
const fixtureFetch = globalThis.fetch
const fs = require('node:fs')
const labels = ['MIN', 'PTS', 'FG', '3PT', 'REB', 'AST', '+/-']
const line = (id, name, stats, didNotPlay = false) => ({
  athlete: { id, displayName: name, shortName: name, position: { abbreviation: 'G' }, jersey: '11' },
  starter: !didNotPlay, didNotPlay, reason: didNotPlay ? 'QA DNP reason' : undefined, stats,
})
const block = (id, displayName, athletes) => ({ team: { id, displayName }, statistics: [{ names: labels, athletes, totals: [] }] })
globalThis.fetch = async (input, options) => {
  const url = String(input?.url || input)
  const mode = process.env.QA_FIXTURE_MODE_FILE && fs.existsSync(process.env.QA_FIXTURE_MODE_FILE) ? fs.readFileSync(process.env.QA_FIXTURE_MODE_FILE, 'utf8').trim() : 'available'
  if (url.startsWith('https://site.web.api.espn.com/') && url.includes('/summary?') && mode === 'available') {
    const event = new URL(url).searchParams.get('event')
    const teams = event === '401859967' ? [
      block('18', 'New York Knicks', [line('900000001', 'QA Guard', ['38', '29', '10-22', '3-8', '4', '7', '+6']), line('900000002', 'QA Reserve', ['0', '0'], true)]),
      block('24', 'San Antonio Spurs', [line('900000003', 'QA Forward', ['31', '18', '7-15', '0-2', '9', null, '-3'])]),
    ] : event === '401859966' ? [block('18', null, [line('', 'QA Anonymous', ['20', '12'])])]
      : event === '231030025' ? [block('25', 'Seattle SuperSonics', [line('900000001', 'QA Historical Guard', ['30', '19']), line('900000004', 'QA Historical Reserve', ['12', '0'])])]
      : null
    if (teams) return new Response(JSON.stringify({ header: { id: event }, boxscore: { players: teams } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return fixtureFetch(input, options)
}
