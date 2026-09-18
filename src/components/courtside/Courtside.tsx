'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TeamLogo } from '@/components/primitives/TeamLogo'
import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { useFollowing } from '@/hooks/useFollowing'
import type { GameForecasts, GameSide, TeamProjection } from '@/lib/artifacts'
import { easternDay, validateForecasts, predictionRange } from '@/lib/courtside'
import { pct } from '@/lib/format'

const chip = 'min-h-11 rounded-sm border px-3 py-2 text-xs font-numeric transition-colors'
const quiet = 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
const active = 'border-[var(--accent-brand)] bg-[var(--muted-bg)] text-[var(--text-primary)]'
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const tipLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })

export function Courtside({ initial, projections = [], directory = [], compact = false }: {
  initial: GameForecasts | null; projections?: TeamProjection[]; directory?: GameSide[]; compact?: boolean
}) {
  const [data, setData] = useState(initial)
  const [now, setNow] = useState<number | null>(null)
  const [selected, setSelected] = useState('')
  const [day, setDay] = useState('')
  const [team, setTeam] = useState('')
  const [mode, setMode] = useState('all')
  const [coverage, setCoverage] = useState<50 | 80 | 95>(80)
  const [scenario, setScenario] = useState<'home' | 'away' | null>(null)
  const [message, setMessage] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const request = useRef<AbortController | null>(null)
  const { following, toggle } = useFollowing()

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    const sync = () => {
      const query = new URLSearchParams(window.location.search)
      setSelected(query.get('game') || '')
      setDay(query.get('day') || '')
      setTeam(query.get('team') || '')
      setMode(['following', 'close'].includes(query.get('mode') || '') ? query.get('mode')! : 'all')
      setScenario(null)
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => { clearInterval(timer); window.removeEventListener('popstate', sync); request.current?.abort() }
  }, [])

  const games = useMemo(() => (data?.games || []).filter(g => now === null || Date.parse(g.date_utc) > now), [data, now])
  const teams = useMemo(() => {
    const map = new Map<number, GameSide>()
    for (const side of directory) map.set(side.team_id, side)
    for (const game of data?.games || []) for (const side of [game.home, game.away]) map.set(side.team_id, side)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data, directory])
  const filtered = games.filter(g => (!team || g.home.abbreviation === team || g.away.abbreviation === team || String(g.home.team_id) === team || String(g.away.team_id) === team) &&
    (mode !== 'following' || following.includes(g.home.abbreviation) || following.includes(g.away.abbreviation)) &&
    (mode !== 'close' || Math.abs(g.p_home - 0.5) <= 0.1))
  const dates = [...new Set(filtered.map(g => easternDay(g.date_utc)))]
  const selectedDay = day || dates[0] || ''
  const slate = filtered.filter(g => easternDay(g.date_utc) === selectedDay)
  const game = slate.find(g => g.game_id === selected) || slate[0]
  const sharedMissing = selected && !games.some(g => g.game_id === selected)
  useEffect(() => setScenario(null), [game?.game_id])

  function navigate(next: { game?: string; day?: string; team?: string; mode?: string }) {
    const state = { game: selected, day, team, mode, ...next }
    setSelected(state.game); setDay(state.day); setTeam(state.team); setMode(state.mode)
    setScenario(null); setMessage('')
    if (!compact) {
      const url = new URL(window.location.href)
      for (const [key, value] of Object.entries(state)) {
        if (value && !(key === 'mode' && value === 'all')) url.searchParams.set(key, value)
        else url.searchParams.delete(key)
      }
      window.history.pushState(null, '', url)
    }
  }
  function choose(id: string, nextDay = selectedDay) { navigate({ game: id, day: nextDay }) }
  // Resolve a shared game to its slate once the artifact is available.
  useEffect(() => {
    if (!selected || day) return
    const shared = games.find(g => g.game_id === selected)
    if (shared) setDay(easternDay(shared.date_utc))
  }, [selected, day, games])

  async function refresh() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 10_000)
    setRefreshing(true); setMessage('')
    try {
      const response = await fetch('/api/v1/courtside', { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('unavailable')
      const next = validateForecasts(await response.json())
      if (!next) throw new Error('invalid')
      setData(next); setNow(Date.now()); setMessage('Latest published forecasts loaded.')
    } catch {
      setMessage('Could not refresh. Your last loaded forecasts are still here. Try again.')
    } finally { clearTimeout(timeout); setRefreshing(false) }
  }

  async function share() {
    if (!game) return
    const url = new URL('/lab', window.location.origin)
    url.searchParams.set('game', game.game_id)
    try { await navigator.clipboard.writeText(url.toString()); setMessage('Matchup link copied.') }
    catch { setMessage(`Share this matchup: ${url.toString()}`) }
  }

  const stale = data && now !== null && now - Date.parse(data.generated_at) > 48 * 3600_000
  return (
    <section aria-label="Courtside forecast explorer" className="mb-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        {compact ? <div>
          <p className="eyebrow">Your teams. Every possibility.</p>
          <h2 className="mt-1 text-xl">{compact ? 'Courtside' : 'Find your next game'}</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Explore the matchup. Follow your team. See what a win could mean.</p>
        </div> : <h2 className="text-sm">Explore the matchups</h2>}
        {compact ? <Link href="/lab" className={`${chip} ${active}`}>Open Forecast Lab ↗</Link> :
          <button className={`${chip} ${quiet}`} disabled={refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh forecasts'}</button>}
      </div>
      {!compact && teams.length ? <details className="card mb-5 p-4">
        <summary className="min-h-8 cursor-pointer text-sm">Your teams <span className="font-numeric text-[var(--text-tertiary)]">· {following.length} following</span></summary>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">Build your own courtside. Saved on this device, even between seasons.</p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{teams.map(side => <button key={side.abbreviation} aria-pressed={following.includes(side.abbreviation)} onClick={() => toggle(side.abbreviation)} className={`${chip} ${following.includes(side.abbreviation) ? active : quiet} flex items-center gap-3 text-left`}>
          <TeamLogo {...side} size={28} /><span className="flex-1">{side.name}</span><span aria-hidden="true">{following.includes(side.abbreviation) ? '✓' : '+'}</span>
        </button>)}</div>
      </details> : null}
      {!data ? <div className="card p-5"><p>No forecast published yet.</p><p className="mt-2 text-sm text-[var(--text-secondary)]">Refresh to try again when the next forecast is available.</p></div> : <>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="w-full min-w-0 text-xs text-[var(--text-secondary)] sm:w-auto sm:min-w-[180px] sm:flex-1">Team
            <select aria-label="Filter by team" value={team} onChange={e => navigate({ team: e.target.value, day: '', game: '' })} className="mt-1 block min-h-11 w-full rounded-sm border border-[var(--border-color)] bg-[var(--input-bg)] px-3 text-sm">
              <option value="">All teams</option>{teams.map(t => <option key={t.team_id} value={t.abbreviation}>{t.name}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2" aria-label="Game filters">
            {[['all', 'All games'], ['following', 'Following'], ['close', 'Close calls']].map(([value, label]) =>
              <button key={value} aria-pressed={mode === value} className={`${chip} ${mode === value ? active : quiet}`} onClick={() => navigate({ mode: value, day: '', game: '' })}>{label}</button>)}
          </div>
        </div>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">{mode === 'close' ? 'Close calls: each team has a 40–60% published win probability. ' : ''}Slate dates and tip-offs use Eastern time.</p>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2" aria-label="Slate dates">
          {dates.slice(0, compact ? 7 : 21).map(d => <button key={d} aria-pressed={selectedDay === d} onClick={() => navigate({ day: d, game: '' })} className={`${chip} shrink-0 ${selectedDay === d ? active : quiet}`}>{dateLabel(d)}</button>)}
          {!compact && dates.length > 21 ? <label className="sr-only" htmlFor="later-date">All slate dates</label> : null}
        </div>
        {!compact && dates.length > 21 ? <select id="later-date" aria-label="All slate dates" value={dates.includes(selectedDay) ? selectedDay : ''} onChange={e => navigate({ day: e.target.value, game: '' })} className="mb-4 min-h-11 max-w-full border border-[var(--border-color)] bg-[var(--input-bg)] px-3 text-sm"><option value="">Choose a slate</option>{dates.map(d => <option key={d} value={d}>{dateLabel(d)}</option>)}</select> : null}
        {sharedMissing ? <p role="status" className="mb-3 text-sm text-[var(--accent-warn)]">That shared game is no longer in the upcoming forecast. Browse another matchup below.</p> : null}
        {!game ? <div className="card p-6"><p>{mode === 'following' && !following.length ? 'Your courtside starts with a team.' : 'No upcoming games match these filters.'}</p><p className="mt-2 text-sm text-[var(--text-secondary)]">{mode === 'following' && !following.length ? 'Open Your teams above to follow any franchise.' : 'Try another team, slate date, or All games.'}</p><button className={`${chip} ${quiet} mt-4`} onClick={() => navigate({ mode: 'all', team: '', day: '', game: '' })}>Reset filters</button></div> :
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(250px,1fr)]">
            <article className="card min-w-0 overflow-hidden" aria-label="Selected matchup">
              <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3 text-xs text-[var(--text-tertiary)]"><span className="eyebrow">Pre-game forecast</span><span className="font-numeric">{tipLabel(game.date_utc)}</span></div>
              <div className="p-4 sm:p-6">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  {[game.away, game.home].map((side, index) => <div key={side.team_id} className={index ? 'col-start-3 row-start-1 min-w-0 text-center' : 'col-start-1 row-start-1 min-w-0 text-center'}>
                    <TeamLogo {...side} size={56} />
                    <p className="mt-3 font-numeric text-xl sm:text-3xl">{side.abbreviation}</p>
                    <Link href={`/teams/${side.abbreviation}`} className="mt-1 block text-xs text-[var(--accent-info)]">{side.name}</Link>
                    <button aria-pressed={following.includes(side.abbreviation)} className={`${chip} ${quiet} mt-3 px-2`} onClick={() => toggle(side.abbreviation)}>{following.includes(side.abbreviation) ? '✓ Following' : '+ Follow'} <span className="sr-only">{side.name}</span></button>
                    <p className="mt-2 text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">{index ? (game.neutral_site ? 'Designated home' : 'Home') : 'Away'}</p>
                  </div>)}
                  <span className="col-start-2 row-start-1 text-xs text-[var(--text-tertiary)]">AT</span>
                </div>
                <div className="my-6"><p className="eyebrow mb-3">Win probability</p><ProbabilityBar homeLabel={game.home.abbreviation} awayLabel={game.away.abbreviation} pHome={game.p_home} /></div>
                <div className="grid grid-cols-3 gap-2 border-y border-[var(--border-color)] py-4">
                  <Metric label="Mean score" value={`${game.exp_away_score.toFixed(0)} – ${game.exp_home_score.toFixed(0)}`} />
                  <Metric label="Home margin" value={`${game.exp_margin > 0 ? '+' : ''}${game.exp_margin.toFixed(1)}`} />
                  <Metric label="Total points" value={game.exp_total.toFixed(1)} />
                </div>
                {!compact ? <div className="mt-4 rounded-sm bg-[var(--muted-bg)] p-3" aria-label="Forecast uncertainty">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs">Room for the unexpected</h3><div className="flex gap-1" aria-label="Prediction range coverage">{([50, 80, 95] as const).map(value => <button key={value} aria-pressed={coverage === value} onClick={() => setCoverage(value)} className={`${chip} ${coverage === value ? active : quiet}`}>{value}%</button>)}</div></div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[var(--text-secondary)]">{game.home.abbreviation} margin range</dt><dd className="mt-1 font-numeric text-lg">{predictionRange(game.exp_margin, game.margin_sd, coverage).join(' to ')}</dd></div><div><dt className="text-[var(--text-secondary)]">Total points range</dt><dd className="mt-1 font-numeric text-lg">{predictionRange(game.exp_total, game.total_sd, coverage).join(' to ')}</dd></div></dl>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">Central {coverage}% of the model’s assumed normal distribution. Negative margin means {game.away.abbreviation} wins. These ranges describe game variability; their real-world coverage has not been validated.</p>
                </div> : null}
                <p className="mt-3 text-xs text-[var(--text-tertiary)]">Expected scores are averages, not an exact-score pick. {game.venue || 'Venue not published'}.</p>
                {compact ? null : <div className="mt-5 border-t border-[var(--border-color)] pt-4">
                  <h3 className="text-xs">What if they win?</h3>
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">One game added to today’s record. Season odds stay at their published values.</p>
                  <div className="mt-3 flex flex-wrap gap-2">{(['away', 'home'] as const).map(side => <button key={side} aria-pressed={scenario === side} className={`${chip} ${scenario === side ? active : quiet}`} onClick={() => setScenario(side)}>{game[side].abbreviation} wins</button>)}</div>
                  {scenario ? <div className="mt-3 text-sm" role="status">{[game.away, game.home].map(side => {
                    const projection = projections.find(p => p.team_id === side.team_id)
                    const winner = game[scenario].team_id === side.team_id
                    return <p key={side.team_id} className="mt-1 font-numeric">{side.abbreviation}: {projection ? `${projection.current_wins + (winner ? 1 : 0)}–${projection.current_losses + (winner ? 0 : 1)} hypothetical record` : 'current record unavailable'}</p>
                  })}</div> : null}
                </div>}
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href={`/games/${game.game_id}`} className={`${chip} ${active}`}>Game breakdown ↗</Link>
                  <button onClick={share} className={`${chip} ${quiet}`}>Copy matchup link</button>
                </div>
              </div>
            </article>
            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-xs">On this slate</h3><span className="font-numeric text-xs text-[var(--text-tertiary)]">{slate.length} games</span></div>
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">{slate.map(g => <button key={g.game_id} aria-pressed={game.game_id === g.game_id} onClick={() => choose(g.game_id)} className={`w-full rounded-sm border p-3 text-left ${game.game_id === g.game_id ? active : quiet} bg-[var(--card-bg)]`}>
                <span className="flex items-center gap-2"><TeamLogo {...g.away} size={24} /><span className="font-numeric text-sm">{g.away.abbreviation} <span className="text-[var(--text-tertiary)]">at</span> {g.home.abbreviation}</span><TeamLogo {...g.home} size={24} /></span>
                <span className="mt-2 flex justify-between gap-2 font-numeric text-xs"><span>{pct(g.p_away)} / {pct(g.p_home)}</span><span className="text-[var(--text-tertiary)]">{new Date(g.date_utc).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET</span></span>
              </button>)}</div>
              <div className="mt-4 border-t border-[var(--border-color)] pt-4"><p className="eyebrow">Beyond tonight</p><div className="mt-3 flex flex-wrap gap-3 text-sm text-[var(--accent-info)]"><Link href="/season">Season outlook ↗</Link><Link href="/bracket">Playoff paths ↗</Link><Link href="/predict">Any matchup ↗</Link></div></div>
              <div className="mt-5 text-xs leading-relaxed text-[var(--text-secondary)]"><p>Ratings, recent form and schedule features inform this forecast. Confirmed lineups and injuries are not included.</p><Link href="/accuracy" className="mt-2 inline-block text-[var(--accent-info)]">See how the model measures up ↗</Link></div>
            </div>
          </div>}
        <div className="mt-4 text-xs leading-relaxed text-[var(--text-tertiary)]">
          <p className="break-words">Published {tipLabel(data.generated_at)} · model {data.model_version}</p>
          <p>{data.trained_through ? `Trained through ${tipLabel(data.trained_through)}.` : 'Training cutoff was not recorded in this artifact.'} {data.feature_pipeline === 'season-boundary-and-schedule-v2' ? 'Long-range forecasts advance scheduled rest and game load while holding observed form and ratings fixed.' : 'Long-range forecasts use the current team state.'} These are not live win probabilities.</p>
          {stale ? <p className="mt-2 text-[var(--accent-warn)]">This forecast is more than 48 hours old. Newer results or schedule changes may be missing.</p> : null}
        </div>
      </>}
      <p role="status" className="mt-3 break-words text-sm text-[var(--text-secondary)]">{message}</p>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p><p className="mt-1 font-numeric text-base sm:text-xl">{value}</p></div>
}
