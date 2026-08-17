"""Where the thirty NBA arenas are, and how high.

**This is reference data, not observed data, and the distinction matters
here.** The project's standing rule is that sparse coverage stays genuinely
missing and a plausible value is never imputed. That rule is about
observations — a price nobody published, a box score ESPN never filed. The
latitude of an arena is not an observation about a game; it is a public,
checkable geographic fact that does not vary, and there is no version of it
that "goes missing" for some games and not others.

It lives in code rather than in the warehouse because ESPN does not publish
coordinates. Its `gameInfo.venue` block carries a name and a city and stops
there, and `teams` carries no venue at all — which is why `teams.venue_lat`,
`teams.venue_lon` and `teams.venue_altitude_m` sat in the schema, NULL for
all thirty franchises, from the day it was written.

Altitudes are the arena floor's elevation above sea level in metres. **Only
one of them is interesting** and it is the reason this file exists: Denver
plays at 1,610m and everybody else plays between sea level and 250m. Utah at
1,288m is the only other outlier. A "home altitude advantage" that is really
two teams is a fact worth modelling explicitly rather than smearing across
thirty.

Franchises are keyed by ESPN's abbreviation, which is the stable identifier
this project already uses everywhere and does not change when a franchise
renames its building. **Arena names are recorded for a human reading the
table, not matched on**: they are sponsorship deals and several change every
few years, whereas the coordinates move only if a team actually moves.

If a franchise relocates or opens a new building, this table is edited by a
person. That is the correct amount of ceremony for something that happens
roughly once a decade.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple


@dataclass(frozen=True)
class Arena:
    abbreviation: str
    name: str
    city: str
    latitude: float
    longitude: float
    altitude_m: float
    # Hours from UTC at standard time. Used for the direction and size of a
    # body-clock shift, never for scheduling — every timestamp in this project
    # is UTC and every calendar day is bucketed on US Eastern.
    utc_offset: float


ARENAS: Dict[str, Arena] = {
    a.abbreviation: a
    for a in (
        Arena("ATL", "State Farm Arena", "Atlanta", 33.7573, -84.3963, 320, -5),
        Arena("BOS", "TD Garden", "Boston", 42.3662, -71.0621, 6, -5),
        Arena("BKN", "Barclays Center", "Brooklyn", 40.6826, -73.9754, 12, -5),
        Arena("CHA", "Spectrum Center", "Charlotte", 35.2251, -80.8392, 229, -5),
        Arena("CHI", "United Center", "Chicago", 41.8807, -87.6742, 180, -6),
        Arena("CLE", "Rocket Arena", "Cleveland", 41.4965, -81.6882, 199, -5),
        Arena("DAL", "American Airlines Center", "Dallas", 32.7905, -96.8103, 137, -6),
        # The whole reason this module exists.
        Arena("DEN", "Ball Arena", "Denver", 39.7487, -105.0077, 1610, -7),
        Arena("DET", "Little Caesars Arena", "Detroit", 42.3410, -83.0552, 180, -5),
        Arena("GS", "Chase Center", "San Francisco", 37.7680, -122.3877, 5, -8),
        Arena("HOU", "Toyota Center", "Houston", 29.7508, -95.3621, 15, -6),
        Arena("IND", "Gainbridge Fieldhouse", "Indianapolis", 39.7640, -86.1555, 218, -5),
        Arena("LAC", "Intuit Dome", "Inglewood", 33.9450, -118.3417, 38, -8),
        Arena("LAL", "Crypto.com Arena", "Los Angeles", 34.0430, -118.2673, 88, -8),
        Arena("MEM", "FedExForum", "Memphis", 35.1382, -90.0506, 78, -6),
        Arena("MIA", "Kaseya Center", "Miami", 25.7814, -80.1870, 2, -5),
        Arena("MIL", "Fiserv Forum", "Milwaukee", 43.0451, -87.9172, 180, -6),
        Arena("MIN", "Target Center", "Minneapolis", 44.9795, -93.2760, 253, -6),
        Arena("NO", "Smoothie King Center", "New Orleans", 29.9490, -90.0821, 1, -6),
        Arena("NY", "Madison Square Garden", "New York", 40.7505, -73.9934, 11, -5),
        Arena("OKC", "Paycom Center", "Oklahoma City", 35.4634, -97.5151, 366, -6),
        Arena("ORL", "Kia Center", "Orlando", 28.5392, -81.3839, 32, -5),
        Arena("PHI", "Wells Fargo Center", "Philadelphia", 39.9012, -75.1720, 3, -5),
        Arena("PHX", "Mortgage Matchup Center", "Phoenix", 33.4457, -112.0712, 331, -7),
        Arena("POR", "Moda Center", "Portland", 45.5316, -122.6668, 15, -8),
        Arena("SAC", "Golden 1 Center", "Sacramento", 38.5802, -121.4997, 9, -8),
        Arena("SA", "Frost Bank Center", "San Antonio", 29.4270, -98.4375, 198, -6),
        Arena("TOR", "Scotiabank Arena", "Toronto", 43.6435, -79.3791, 76, -5),
        # Salt Lake City, the only other arena above a kilometre.
        Arena("UTAH", "Delta Center", "Salt Lake City", 40.7683, -111.9011, 1288, -7),
        Arena("WSH", "Capital One Arena", "Washington", 38.8981, -77.0209, 3, -5),
    )
}

# Phoenix does not observe daylight saving. Recorded because a naive
# offset-based body-clock feature would otherwise put Phoenix an hour out for
# eight months of the year — a small error, but a systematic one, and it
# costs one line to be right about.
NO_DST = frozenset({"PHX"})

EARTH_RADIUS_KM = 6371.0088


def arena_for(abbreviation: Optional[str]) -> Optional[Arena]:
    """The arena, or None for an unknown or absent franchise.

    None rather than a raise: this is called on every row of a 30,000-game
    corpus that includes relocations and, in the archive, franchises under
    former abbreviations. A missing arena has to be a value the caller can
    branch on, not an exception that stops a build.
    """
    if not abbreviation:
        return None
    return ARENAS.get(abbreviation.strip().upper())


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Great-circle distance in kilometres between two (lat, lon) pairs.

    Great-circle rather than driving distance because teams fly, and the two
    differ by a constant-ish factor that a fitted coefficient absorbs anyway.
    """
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def distance_between(a: Optional[str], b: Optional[str]) -> Optional[float]:
    """Kilometres between two franchises' arenas, or None if either is unknown."""
    first, second = arena_for(a), arena_for(b)
    if first is None or second is None:
        return None
    return haversine_km(
        (first.latitude, first.longitude), (second.latitude, second.longitude)
    )


def timezone_shift(from_abbr: Optional[str], to_abbr: Optional[str]) -> Optional[float]:
    """Signed hours of body-clock shift travelling from one arena to another.

    Positive is eastward — the direction that costs a team an hour of sleep
    and is the one the sports-science literature finds harder. Sign is kept
    for exactly that reason; an absolute value would fold the asymmetry away
    before the model could measure it.
    """
    first, second = arena_for(from_abbr), arena_for(to_abbr)
    if first is None or second is None:
        return None
    return second.utc_offset - first.utc_offset


def altitude_delta(home_abbr: Optional[str], visitor_abbr: Optional[str]) -> Optional[float]:
    """Metres the visitor is playing above the altitude it lives at.

    Positive means thinner air than the visiting team is acclimatised to.
    Denver's opponents arrive at roughly +1,400m; the reverse trip is
    negative and is not expected to hurt anybody, which is precisely why the
    signed value is what gets modelled.
    """
    venue, visitor = arena_for(home_abbr), arena_for(visitor_abbr)
    if venue is None or visitor is None:
        return None
    return venue.altitude_m - visitor.altitude_m
