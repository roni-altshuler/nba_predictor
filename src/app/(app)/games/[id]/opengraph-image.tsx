import { ImageResponse } from 'next/og'

import { getGameForecasts } from '@/lib/artifacts'
import { getArchivedGame } from '@/lib/history'

/**
 * The social card for one game.
 *
 * **Every shared link on this site previewed identically until now** — a
 * playoff game seven and the ratings page produced the same generic card,
 * which is the single cheapest thing wrong with how this project travels.
 * A card that names the two teams and prints the number is the whole product
 * in one image.
 *
 * Drawn rather than screenshotted, in the site's own tokens: pure black,
 * white letterspaced display, monospace numerals, one hairline. **No logos.**
 * NBA marks are authored for light backgrounds and several vanish on black —
 * the same reason the site puts them on a plate — and a remote image fetched
 * at card-render time is a network dependency inside an image route that has
 * no way to report a failure.
 *
 * The forecast is stated as a probability with the favourite named, because
 * a bare "62%" out of context does not say 62% of what.
 */

export const runtime = 'nodejs'
export const alt = 'Hardwood game forecast'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#f5f5f5'
const MUTED = '#8a8a8a'
const LINE = '#262626'

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = describe(id)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#000',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              color: INK,
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
            }}
          >
            Hardwood
          </div>
          <div style={{ color: MUTED, fontSize: 20, letterSpacing: 2 }}>
            {card.eyebrow}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 28,
              color: INK,
              fontSize: 92,
              letterSpacing: 2,
            }}
          >
            <span>{card.away}</span>
            <span style={{ color: MUTED, fontSize: 40 }}>{card.joiner}</span>
            <span>{card.home}</span>
          </div>
          <div style={{ display: 'flex', color: MUTED, fontSize: 30 }}>
            {card.line}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderTop: `1px solid ${LINE}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: 'flex', color: MUTED, fontSize: 22 }}>
            {card.footer}
          </div>
          <div style={{ display: 'flex', color: MUTED, fontSize: 20 }}>
            Scored against the closing line
          </div>
        </div>
      </div>
    ),
    size,
  )
}

interface Card {
  eyebrow: string
  away: string
  home: string
  joiner: string
  line: string
  footer: string
}

/**
 * What the card says, for each of the three kinds of game page.
 *
 * A game the site knows nothing about still gets a card rather than a
 * failure: an image route that throws produces a broken preview, which is
 * worse than a plain one.
 */
function describe(id: string): Card {
  const archived = getArchivedGame(id)
  if (archived) {
    const g = archived.game
    const homeWon = g.home_score > g.away_score
    return {
      eyebrow: `${g.season - 1}–${String(g.season).slice(2)}`,
      away: g.away,
      home: g.home,
      joiner: `${g.away_score} – ${g.home_score}`,
      line:
        g.p_model === undefined || g.p_model === null
          ? 'Final'
          : `The model gave ${homeWon ? g.home : g.away} ${pct(
              homeWon ? g.p_model : 1 - g.p_model,
            )} — a backtest, not a published call`,
      footer: new Date(g.date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      }),
    }
  }

  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) {
    const favourite =
      upcoming.p_home >= 0.5 ? upcoming.home : upcoming.away
    const probability = Math.max(upcoming.p_home, upcoming.p_away)
    return {
      eyebrow: 'Forecast',
      away: upcoming.away.abbreviation,
      home: upcoming.home.abbreviation,
      joiner: 'at',
      line: `${favourite.name} ${pct(probability)} · projected ${Math.round(
        upcoming.exp_away_score,
      )}–${Math.round(upcoming.exp_home_score)}`,
      footer: new Date(upcoming.date_utc).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/New_York',
      }),
    }
  }

  return {
    eyebrow: 'Game',
    away: 'NBA',
    home: 'Hardwood',
    joiner: '·',
    line: 'Calibrated NBA game and season forecasting',
    footer: 'hardwood',
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}
