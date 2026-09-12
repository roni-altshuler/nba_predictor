/**
 * NBA divisions, keyed by ESPN abbreviation — the key every artifact uses.
 *
 * League structure, not model output. The artifacts publish conference
 * only, and a division is a fixed public fact rather than a forecast — the
 * one kind of value this frontend may hold without an artifact behind it.
 * A team missing from this table is grouped under its conference as
 * "unassigned" rather than dropped, so a rename or an expansion shows up as
 * a visible gap instead of a silent one.
 */
export const DIVISIONS: Record<string, string> = {
  BOS: 'Atlantic', BKN: 'Atlantic', NY: 'Atlantic', PHI: 'Atlantic', TOR: 'Atlantic',
  CHI: 'Central', CLE: 'Central', DET: 'Central', IND: 'Central', MIL: 'Central',
  ATL: 'Southeast', CHA: 'Southeast', MIA: 'Southeast', ORL: 'Southeast', WSH: 'Southeast',
  DEN: 'Northwest', MIN: 'Northwest', OKC: 'Northwest', POR: 'Northwest', UTAH: 'Northwest',
  GS: 'Pacific', LAC: 'Pacific', LAL: 'Pacific', PHX: 'Pacific', SAC: 'Pacific',
  DAL: 'Southwest', HOU: 'Southwest', MEM: 'Southwest', NO: 'Southwest', SA: 'Southwest',
}

/** Conferences in display order, each with its divisions in display order. */
export const DIVISION_ORDER: Array<{ conference: string; short: string; divisions: string[] }> = [
  { conference: 'Eastern Conference', short: 'East', divisions: ['Atlantic', 'Central', 'Southeast'] },
  { conference: 'Western Conference', short: 'West', divisions: ['Northwest', 'Pacific', 'Southwest'] },
]

export const UNASSIGNED = 'Unassigned'

export interface DivisionGroup<T> {
  conference: string
  short: string
  divisions: Array<{ name: string; items: T[] }>
}

/**
 * Group anything carrying a team by conference, then division. Input order
 * is kept inside a division, so callers that pass rating order get a ladder
 * inside each row. Unknown conferences are appended after the two known
 * ones, and unknown teams land in an `Unassigned` division of their
 * conference — present, and labelled as such.
 */
export function groupByDivision<T>(
  items: T[],
  team: (item: T) => { abbreviation: string; conference: string },
): Array<DivisionGroup<T>> {
  const groups = new Map<string, DivisionGroup<T>>()
  for (const spec of DIVISION_ORDER) {
    groups.set(spec.conference, {
      conference: spec.conference,
      short: spec.short,
      divisions: spec.divisions.map((name) => ({ name, items: [] })),
    })
  }
  for (const item of items) {
    const { abbreviation, conference } = team(item)
    let group = groups.get(conference)
    if (!group) {
      group = { conference, short: conference.replace(' Conference', ''), divisions: [] }
      groups.set(conference, group)
    }
    const name = DIVISIONS[abbreviation] ?? UNASSIGNED
    let division = group.divisions.find((d) => d.name === name)
    if (!division) {
      division = { name, items: [] }
      group.divisions.push(division)
    }
    division.items.push(item)
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      divisions: group.divisions.filter((d) => d.items.length > 0),
    }))
    .filter((group) => group.divisions.length > 0)
}
