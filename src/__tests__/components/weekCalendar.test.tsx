import { render, screen } from '@testing-library/react'

import { WeekCalendar } from '@/components/schedule/WeekCalendar'
import type { GameForecast, GameWeek } from '@/lib/artifacts'

function game(id: string, dateUtc: string, home = 'HOM', away = 'AWY'): GameForecast {
  return {
    game_id: id,
    date_utc: dateUtc,
    venue: null,
    neutral_site: false,
    home: {
      team_id: 1, name: `${home} team`, abbreviation: home,
      conference: 'Eastern Conference', logo: null, elo: 1600,
    },
    away: {
      team_id: 2, name: `${away} team`, abbreviation: away,
      conference: 'Eastern Conference', logo: null, elo: 1500,
    },
    p_home: 0.62, p_away: 0.38,
    exp_margin: 4, exp_total: 220,
    exp_home_score: 112, exp_away_score: 108,
    margin_sd: 13, total_sd: 20,
  }
}

const WEEK: GameWeek = {
  week: 1,
  start: '2026-10-19',
  end: '2026-10-25',
  anchored: true,
  games: 2,
  days: [
    ['2026-10-20', [game('a', '2026-10-21T00:00:00+00:00')]],
    ['2026-10-22', [game('b', '2026-10-23T00:00:00+00:00', 'BOS', 'DET')]],
  ],
}

describe('WeekCalendar', () => {
  it('draws all seven days, including the ones with no games', () => {
    // A week with no Thursday game should show an empty Thursday. Collapsing
    // it shifts every other column and makes two weeks with different rest
    // patterns look identical.
    render(<WeekCalendar week={WEEK} />)
    for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByText(new RegExp(`^${name} \\d+$`))).toBeInTheDocument()
    }
    expect(screen.getAllByText('No games')).toHaveLength(5)
  })

  it('numbers the days from the week start, not from the games it holds', () => {
    render(<WeekCalendar week={WEEK} />)
    expect(screen.getByText('Mon 19')).toBeInTheDocument()
    expect(screen.getByText('Sun 25')).toBeInTheDocument()
  })

  it('makes every game a link to its own page', () => {
    render(<WeekCalendar week={WEEK} />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/games/a',
      '/games/b',
    ])
  })

  it('prints both probabilities as text rather than as a bar', () => {
    // At chip size a bar would be four pixels of hue carrying the only
    // number on the card. Colour never carries a value on this site.
    render(<WeekCalendar week={WEEK} />)
    expect(screen.getAllByText('62%')).toHaveLength(2)
    expect(screen.getAllByText('38%')).toHaveLength(2)
  })

  it('names both sides in the accessible label of the chip', () => {
    render(<WeekCalendar week={WEEK} />)
    expect(
      screen.getByRole('link', { name: /DET team at BOS team/i }),
    ).toBeInTheDocument()
  })
})
