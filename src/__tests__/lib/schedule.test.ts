import { groupByWeek } from '@/lib/artifacts'
import type { GameForecast } from '@/lib/artifacts'

/**
 * NBA week grouping.
 *
 * A week runs Monday to Sunday and week 1 is the week containing the season
 * opener — the league's own scheduling unit, and the one every rest and
 * back-to-back argument is framed in.
 */

function game(id: string, dateUtc: string): GameForecast {
  return {
    game_id: id,
    date_utc: dateUtc,
    venue: null,
    neutral_site: false,
    home: {
      team_id: 1, name: 'Home', abbreviation: 'HOM',
      conference: 'Eastern Conference', logo: null, elo: 1500,
    },
    away: {
      team_id: 2, name: 'Away', abbreviation: 'AWY',
      conference: 'Eastern Conference', logo: null, elo: 1500,
    },
    p_home: 0.5, p_away: 0.5,
    exp_margin: 0, exp_total: 220,
    exp_home_score: 110, exp_away_score: 110,
    margin_sd: 13, total_sd: 20,
  }
}

// The 2026-27 opener: Tuesday 20 October 2026, 19:00 UTC. Its Monday is the
// 19th, so week 1 runs 19-25 October.
const OPENER = '2026-10-20T19:00:00+00:00'

describe('groupByWeek', () => {
  it('numbers weeks from the season opener, not from the first game shown', () => {
    // The bug this guards: anchoring on the earliest REMAINING fixture
    // renumbers week 1 onto whatever is next every morning, which looks
    // right in October and is nonsense by December.
    const midSeason = [
      game('a', '2026-12-29T00:00:00+00:00'),
      game('b', '2026-12-30T00:00:00+00:00'),
    ]
    const weeks = groupByWeek(midSeason, OPENER)
    expect(weeks).toHaveLength(1)
    expect(weeks[0].week).toBe(11)
    expect(weeks[0].anchored).toBe(true)
  })

  it('runs a week Monday to Sunday', () => {
    const weeks = groupByWeek([game('a', OPENER)], OPENER)
    expect(weeks[0].start).toBe('2026-10-19')
    expect(weeks[0].end).toBe('2026-10-25')
  })

  it('puts Sunday in the week that began the Monday before it', () => {
    // Sunday is the LAST day of a Monday-start week, not the first. Getting
    // this backwards is the classic off-by-one: JS getUTCDay makes Sunday 0.
    const weeks = groupByWeek(
      [
        game('sun', '2026-10-26T00:00:00+00:00'),   // 25 Oct Eastern, Sunday
        game('mon', '2026-10-27T00:00:00+00:00'),   // 26 Oct Eastern, Monday
      ],
      OPENER,
    )
    expect(weeks.map((w) => w.week)).toEqual([1, 2])
    expect(weeks[0].days[0][0]).toBe('2026-10-25')
  })

  it('groups days inside a week and counts the games', () => {
    const weeks = groupByWeek(
      [
        game('a', '2026-10-21T00:00:00+00:00'),
        game('b', '2026-10-21T02:00:00+00:00'),
        game('c', '2026-10-23T00:00:00+00:00'),
      ],
      OPENER,
    )
    expect(weeks).toHaveLength(1)
    expect(weeks[0].games).toBe(3)
    expect(weeks[0].days).toHaveLength(2)
  })

  it('keeps weeks in order and leaves no phantom empty week', () => {
    // A three-week gap must not manufacture two empty weeks between them.
    const weeks = groupByWeek(
      [
        game('a', OPENER),
        game('b', '2026-11-10T00:00:00+00:00'),
      ],
      OPENER,
    )
    expect(weeks.map((w) => w.week)).toEqual([1, 4])
  })

  it('falls back to the earliest game and SAYS so when no opener is published', () => {
    // Reported rather than silently wrong: an unanchored "week 1" is a
    // different claim from an anchored one.
    const weeks = groupByWeek([game('a', '2026-12-29T00:00:00+00:00')])
    expect(weeks[0].week).toBe(1)
    expect(weeks[0].anchored).toBe(false)
  })

  it('returns nothing for an empty schedule rather than one empty week', () => {
    expect(groupByWeek([], OPENER)).toEqual([])
  })
})
