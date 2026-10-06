// Synthetic browser-QA response only. Run in an isolated /tmp copy; never
// launch production with this preload. No external ESPN request is sent.
const fs = require('node:fs')
const originalFetch = globalThis.fetch
const line = (id, name, dnp = false) => ({
  athlete: { id, displayName: name, shortName: name, position: { abbreviation: 'G' }, jersey: dnp ? '44' : '11' },
  starter: !dnp, didNotPlay: dnp, reason: dnp ? 'QA DNP reason' : undefined,
  stats: dnp ? [] : ['38', '29', '10-22', '3-8', '4', '7', '+6'],
})
const payload = {
  boxscore: { players: [{
    team: { id: '18', abbreviation: 'NY', displayName: 'New York Knicks' },
    statistics: [{ names: ['MIN', 'PTS', 'FG', '3PT', 'REB', 'AST', '+/-'], athletes: [line('900000001', 'QA Guard'), line('900000002', 'QA Reserve', true)], totals: [] }],
  }] },
}
// These are supplied test responses, not a historical-team lookup used by the
// app. Game IDs/provider mappings come from the committed 2003/2004 results.
const historical = {
  '231030025': { id: '25', abbreviation: 'SEA', displayName: 'Seattle SuperSonics' },
  '241103012': { id: '25', abbreviation: 'SEA', displayName: 'Seattle SuperSonics' },
  '231029028': { id: '17', abbreviation: 'NJ', displayName: 'New Jersey Nets' },
  '241103017': { id: '17', abbreviation: 'NJ', displayName: 'New Jersey Nets' },
  '231029003': { id: '3', abbreviation: 'NO', displayName: 'New Orleans Hornets' },
  '241103003': { id: '3', abbreviation: 'NO', displayName: 'New Orleans Hornets' },
  '231031012': { id: '25', abbreviation: 'SEA', displayName: null },
}
globalThis.fetch = async (input, options) => {
  const url = String(input?.url || input)
  if (url.startsWith('https://site.web.api.espn.com/')) {
    const mode = process.env.QA_FIXTURE_MODE_FILE && fs.existsSync(process.env.QA_FIXTURE_MODE_FILE) ? fs.readFileSync(process.env.QA_FIXTURE_MODE_FILE, 'utf8').trim() : 'available'
    if (url.includes('/summary?event=401859967') && mode === 'available') {
      await new Promise(resolve => setTimeout(resolve, 800))
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const event = new URL(url).searchParams.get('event')
    if (historical[event] && mode === 'available') {
      return new Response(JSON.stringify({ header: { id: event }, boxscore: { players: [{
        ...payload.boxscore.players[0], team: historical[event],
        statistics: [{ ...payload.boxscore.players[0].statistics[0], athletes: [line('900000001', 'QA Historical Guard')] }],
      }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
  return originalFetch(input, options)
}
