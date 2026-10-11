import type { GameForecast } from './artifacts'
import { easternDay } from './courtside'

/** Only this team's published display fields cross the client boundary. */
export interface TeamScheduleGame {
  id: string
  date: string
  day: string
  home: boolean
  neutral: boolean
  opponent: { name: string; abbreviation: string; logo: string | null }
  venue: string | null
  probability: number
  teamScore: number
  opponentScore: number
  total: number
}

export function teamScheduleGames(games: GameForecast[], teamId: number): TeamScheduleGame[] {
  return games.filter(game => game.home.team_id === teamId || game.away.team_id === teamId)
    .sort((a, b) => Date.parse(a.date_utc) - Date.parse(b.date_utc) || a.game_id.localeCompare(b.game_id))
    .map(game => {
      const home = game.home.team_id === teamId
      const opponent = home ? game.away : game.home
      return {
        id: game.game_id, date: game.date_utc, day: easternDay(game.date_utc), home,
        neutral: game.neutral_site,
        opponent: { name: opponent.name, abbreviation: opponent.abbreviation, logo: opponent.logo },
        venue: game.venue, probability: home ? game.p_home : game.p_away,
        teamScore: home ? game.exp_home_score : game.exp_away_score,
        opponentScore: home ? game.exp_away_score : game.exp_home_score,
        total: game.exp_total,
      }
    })
}

export const SCHEDULE_PAGE_SIZE = 6
export type ScheduleVenue = '' | 'home' | 'away' | 'neutral'
export interface ScheduleSelection { month: string; venue: ScheduleVenue; count: number }

export function scheduleSelection(query: URLSearchParams, months: string[], maximum: number): ScheduleSelection {
  const month = query.get('scheduleMonth') ?? ''
  const venue = query.get('scheduleVenue') ?? ''
  const count = Number(query.get('scheduleCount') ?? SCHEDULE_PAGE_SIZE)
  return {
    month: months.includes(month) ? month : '',
    venue: venue === 'home' || venue === 'away' || venue === 'neutral' ? venue : '',
    count: Number.isSafeInteger(count) && count >= SCHEDULE_PAGE_SIZE && count % SCHEDULE_PAGE_SIZE === 0
      ? Math.min(count, Math.max(SCHEDULE_PAGE_SIZE, maximum)) : SCHEDULE_PAGE_SIZE,
  }
}

export function scheduleMonthLabel(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
