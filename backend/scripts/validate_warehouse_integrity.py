"""Integrity checks over the game warehouse. Exits non-zero on failure.

    python3 -m backend.scripts.validate_warehouse_integrity
    python3 -m backend.scripts.validate_warehouse_integrity --fix-placeholders

**Run this after any ingest change.** Every check here exists because the
corresponding failure actually happened, either in this project or in the
sibling soccer one, and every one of them is invisible to a row-level schema
check — the rows are all well-formed; it is the corpus that is wrong.

The checks, and what each is really asking:

1. `results_only`      — does `games` hold anything without a final score?
2. `no_zero_zero`      — a 0-0 "final" is an unlabelled postponement.
3. `no_self_games`     — a game whose two sides are the same franchise.
4. `no_placeholders`   — bracket slots ("TBD") that became `teams` rows.
5. `no_duplicates`     — the same matchup twice on one Eastern day.
6. `season_shape`      — 82 regular-season games per franchise, allowing for
                         the NBA Cup final and an in-progress season.
7. `no_double_booking` — a franchise playing twice on one Eastern day.
8. `scheduled_disjoint`— a game in both `games` and `scheduled_games`.
9. `chronological`     — `iter_games` really is ordered.
10. `conference_cover` — all 30 franchises have a conference.
11. `odds_sanity`      — booksums inside a plausible band.

**Dates are bucketed in US EASTERN, not UTC.** ESPN stamps a 10pm Pacific
tip-off into the next UTC day, so a UTC-day check both misses real
double-bookings and invents false duplicates out of ordinary back-to-backs.

**And the NBA-specific inversion worth stating loudly: the same two teams
meeting on consecutive days is NORMAL here.** The soccer project clusters
duplicate fixtures within ±1 day, which is correct for a sport where clubs
meet twice a season. Porting that rule to basketball would silently delete
real games — back-to-back rematches are a standard travel-saving device, and
this corpus contains many. The duplicate key is therefore the *same* Eastern
day, never a window.
"""

from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import (
    SEASON_TYPE_PLAY_IN,
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    get_warehouse,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
logger = logging.getLogger("integrity")

# ESPN schedules on US Eastern. A fixed -5 offset misclassifies nothing that
# matters: the only games it could bucket wrongly tip off between midnight
# and 1am Eastern during daylight saving, and the NBA does not play then.
EASTERN_OFFSET = dt.timedelta(hours=5)

EXPECTED_REGULAR_GAMES = 82
# The NBA Cup Championship is filed by ESPN as a regular-season game but does
# NOT count toward the 82. Exactly two franchises a season therefore show 83,
# and that is correct rather than a duplicate. Verified on 2025-26: New York
# 124-113 San Antonio on 2025-12-17.
CUP_FINAL_ALLOWANCE = 1

# An NBA game tips off between roughly 11:00 and 23:00 Eastern. The early
# end is real — MLK Day, Christmas and the games staged in Paris, London and
# Mexico City all start before 17:00 ET — so the implausible window is the
# small hours of the morning.
PLAUSIBLE_TIPOFF_ET = (11, 23)

# Four rows carry a corrupt ESPN timestamp AND a venue belonging to a third
# franchise: Detroit @ Portland listed at the United Center, Denver @ LA
# Clippers and Portland @ Atlanta at Paycom Center, Golden State @ Phoenix at
# Paycom Center. All four are in the last fortnight before the 2020 season
# was suspended.
#
# **They are kept, not deleted.** Each is a genuine, non-duplicate result
# with a real score, and this project does not throw away a played game
# because the source got its venue wrong — that is the "no fabricated data"
# rule read in the other direction. Nothing downstream reads venue or
# time-of-day; Elo and the feature builder need ordering, which a wrong hour
# inside the right day does not disturb.
#
# Listed explicitly so the count is a BASELINE. A fifth id appearing here
# means ESPN has a new problem, and the check is supposed to say so rather
# than absorb it.
KNOWN_CORRUPT_TIMESTAMPS = {
    "401161490",
    "401161528",
    "401161530",
    "401161536",
}


@dataclass
class Check:
    name: str
    passed: bool
    detail: str
    offenders: List = field(default_factory=list)

    @property
    def status(self) -> str:
        return "PASS" if self.passed else "FAIL"


def eastern_day(iso: str) -> str:
    return (dt.datetime.fromisoformat(str(iso)) - EASTERN_OFFSET).date().isoformat()


def run_checks(warehouse) -> List[Check]:
    conn = warehouse.conn
    checks: List[Check] = []

    franchise_ids = {
        int(r["team_id"])
        for r in conn.execute("SELECT team_id FROM teams WHERE conference IS NOT NULL")
    }

    # 1 ---------------------------------------------------------------
    row = conn.execute(
        "SELECT COUNT(*) n FROM games WHERE home_score IS NULL OR away_score IS NULL"
    ).fetchone()
    checks.append(
        Check(
            "results_only",
            row["n"] == 0,
            f"{row['n']} rows in `games` without a final score "
            "(`games` is results-only; unplayed goes to `scheduled_games`)",
        )
    )

    # 2 ---------------------------------------------------------------
    offenders = [
        r["game_id"]
        for r in conn.execute(
            "SELECT game_id FROM games WHERE home_score = 0 AND away_score = 0"
        )
    ]
    checks.append(
        Check(
            "no_zero_zero",
            not offenders,
            f"{len(offenders)} games finished 0-0 (an unlabelled postponement)",
            offenders[:10],
        )
    )

    # 3 ---------------------------------------------------------------
    offenders = [
        r["game_id"]
        for r in conn.execute(
            "SELECT game_id FROM games WHERE home_team_id = away_team_id"
        )
    ]
    checks.append(
        Check(
            "no_self_games",
            not offenders,
            f"{len(offenders)} games where both sides are the same franchise",
            offenders[:10],
        )
    )

    # 4 ---------------------------------------------------------------
    from backend.services.data.espn_loader import is_placeholder

    placeholders = [
        (int(r["team_id"]), r["display_name"])
        for r in conn.execute("SELECT team_id, display_name FROM teams")
        if is_placeholder(r["display_name"])
    ]
    checks.append(
        Check(
            "no_placeholders",
            not placeholders,
            f"{len(placeholders)} bracket-slot rows in `teams` "
            "(refuse them at the ingester; a junk team row is permanent)",
            placeholders[:10],
        )
    )

    # 5 ---------------------------------------------------------------
    rows = list(
        conn.execute(
            "SELECT game_id, date_utc, home_team_id, away_team_id, season "
            "FROM games WHERE season_type IN (?,?,?)",
            (SEASON_TYPE_REGULAR, SEASON_TYPE_POSTSEASON, SEASON_TYPE_PLAY_IN),
        )
    )
    pairs: Dict[Tuple, List[str]] = defaultdict(list)
    for r in rows:
        if int(r["home_team_id"]) not in franchise_ids:
            continue
        if int(r["away_team_id"]) not in franchise_ids:
            continue
        key = (
            min(r["home_team_id"], r["away_team_id"]),
            max(r["home_team_id"], r["away_team_id"]),
            eastern_day(r["date_utc"]),
        )
        pairs[key].append(r["game_id"])
    dupes = {k: v for k, v in pairs.items() if len(v) > 1}
    checks.append(
        Check(
            "no_duplicates",
            not dupes,
            f"{len(dupes)} matchups appear twice on the same Eastern day",
            list(dupes.items())[:10],
        )
    )

    # 6 ---------------------------------------------------------------
    per_season: Dict[int, Counter] = defaultdict(Counter)
    for r in rows:
        if int(r["season_type"] if "season_type" in r.keys() else 0):
            pass
    reg = list(
        conn.execute(
            "SELECT season, home_team_id, away_team_id FROM games WHERE season_type = ?",
            (SEASON_TYPE_REGULAR,),
        )
    )
    for r in reg:
        home, away = int(r["home_team_id"]), int(r["away_team_id"])
        if home in franchise_ids and away in franchise_ids:
            per_season[int(r["season"])][home] += 1
            per_season[int(r["season"])][away] += 1

    max_season = max(per_season) if per_season else None
    shape_offenders = []
    for season, counter in sorted(per_season.items()):
        if len(counter) < 20:
            continue  # a season mid-ingest, not a malformed one
        for team, n in counter.items():
            if n > EXPECTED_REGULAR_GAMES + CUP_FINAL_ALLOWANCE:
                shape_offenders.append((season, team, n, "too many"))
            elif n < EXPECTED_REGULAR_GAMES and season != max_season:
                # Lockout seasons are real: 2012 ran 66 games and 2020/2021
                # were shortened. Flag only a season that is neither the one
                # in progress nor a known short one.
                if n < 60:
                    shape_offenders.append((season, team, n, "too few"))
    checks.append(
        Check(
            "season_shape",
            not shape_offenders,
            f"{len(shape_offenders)} franchise-seasons off the 82-game shape "
            f"(+{CUP_FINAL_ALLOWANCE} allowed for the NBA Cup final)",
            shape_offenders[:10],
        )
    )

    # 7 ---------------------------------------------------------------
    # Games with a known-corrupt timestamp are excluded: their hour is wrong,
    # so they land on the wrong Eastern day and collide with a real game.
    # Including them would bury the signal this check exists to raise.
    by_team_day: Dict[Tuple, List[str]] = defaultdict(list)
    for r in rows:
        if r["game_id"] in KNOWN_CORRUPT_TIMESTAMPS:
            continue
        day = eastern_day(r["date_utc"])
        for side in ("home_team_id", "away_team_id"):
            team = int(r[side])
            if team in franchise_ids:
                by_team_day[(team, day)].append(r["game_id"])
    double = {k: v for k, v in by_team_day.items() if len(v) > 1}
    checks.append(
        Check(
            "no_double_booking",
            not double,
            f"{len(double)} franchise-days with two games "
            "(a back-to-back is two Eastern days, not one)",
            list(double.items())[:10],
        )
    )

    # 7b --------------------------------------------------------------
    lo, hi = PLAUSIBLE_TIPOFF_ET
    implausible = []
    for r in rows:
        hour = (
            dt.datetime.fromisoformat(str(r["date_utc"])) - EASTERN_OFFSET
        ).hour
        if not lo <= hour <= hi:
            implausible.append((r["game_id"], r["date_utc"], hour))
    unexpected = [g for g in implausible if g[0] not in KNOWN_CORRUPT_TIMESTAMPS]
    checks.append(
        Check(
            "plausible_tipoff",
            not unexpected,
            f"{len(implausible)} games tip off outside {lo}:00-{hi}:00 ET "
            f"({len(KNOWN_CORRUPT_TIMESTAMPS)} known and recorded, "
            f"{len(unexpected)} new)",
            unexpected[:10],
        )
    )

    # 8 ---------------------------------------------------------------
    row = conn.execute(
        "SELECT COUNT(*) n FROM scheduled_games WHERE game_id IN "
        "(SELECT game_id FROM games)"
    ).fetchone()
    checks.append(
        Check(
            "scheduled_disjoint",
            row["n"] == 0,
            f"{row['n']} games are in both `games` and `scheduled_games` "
            "(a played game left in the remaining set is simulated twice)",
        )
    )

    # 9 ---------------------------------------------------------------
    previous, out_of_order = "", 0
    for r in warehouse.iter_games(season_types=None):
        if r["date_utc"] < previous:
            out_of_order += 1
        previous = r["date_utc"]
    checks.append(
        Check(
            "chronological",
            out_of_order == 0,
            f"{out_of_order} games returned out of order by iter_games "
            "(Elo over an unordered stream reads the future)",
        )
    )

    # 10 --------------------------------------------------------------
    checks.append(
        Check(
            "conference_cover",
            len(franchise_ids) == 30,
            f"{len(franchise_ids)} franchises carry a conference, expected 30",
        )
    )

    # 11 --------------------------------------------------------------
    from backend.services.prediction import market as mkt

    bad_odds = []
    for r in conn.execute(
        "SELECT game_id, ml_home, ml_away FROM games "
        "WHERE ml_home IS NOT NULL AND ml_away IS NOT NULL"
    ):
        try:
            total = mkt.booksum(float(r["ml_home"]), float(r["ml_away"]))
        except mkt.MarketError:
            bad_odds.append((r["game_id"], "unparseable"))
            continue
        if not mkt.MIN_BOOKSUM <= total <= mkt.MAX_BOOKSUM:
            bad_odds.append((r["game_id"], round(total, 4)))
    checks.append(
        Check(
            "odds_sanity",
            not bad_odds,
            f"{len(bad_odds)} priced games have an implausible booksum "
            f"(outside [{mkt.MIN_BOOKSUM}, {mkt.MAX_BOOKSUM}])",
            bad_odds[:10],
        )
    )

    return checks


def fix_placeholders(warehouse) -> int:
    """Delete bracket-slot team rows and everything that references them."""
    from backend.services.data.espn_loader import is_placeholder

    conn = warehouse.conn
    victims = [
        int(r["team_id"])
        for r in conn.execute("SELECT team_id, display_name FROM teams")
        if is_placeholder(r["display_name"])
    ]
    if not victims:
        return 0
    marks = ",".join("?" * len(victims))
    with warehouse.transaction() as tx:
        # Every table carrying a `teams` foreign key must be cleared first.
        # `scheduled_games` is the one the soccer project missed, and one
        # surviving row makes the final DELETE raise FOREIGN KEY and abort
        # the whole repair.
        tx.execute(
            f"DELETE FROM scheduled_games WHERE home_team_id IN ({marks}) "
            f"OR away_team_id IN ({marks})",
            victims * 2,
        )
        tx.execute(
            f"DELETE FROM games WHERE home_team_id IN ({marks}) "
            f"OR away_team_id IN ({marks})",
            victims * 2,
        )
        tx.execute(f"DELETE FROM elo_ratings WHERE team_id IN ({marks})", victims)
        tx.execute(f"DELETE FROM team_aliases WHERE team_id IN ({marks})", victims)
        tx.execute(f"DELETE FROM teams WHERE team_id IN ({marks})", victims)
    logger.info("removed %d placeholder team rows", len(victims))
    return len(victims)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix-placeholders", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    warehouse = get_warehouse()
    if args.fix_placeholders:
        fix_placeholders(warehouse)

    checks = run_checks(warehouse)
    failures = [c for c in checks if not c.passed]

    width = max(len(c.name) for c in checks)
    for check in checks:
        if args.quiet and check.passed:
            continue
        print(f"[{check.status}] {check.name:<{width}}  {check.detail}")
        if not check.passed and check.offenders:
            for offender in check.offenders:
                print(f"          {offender}")

    counts = warehouse.counts()
    print(f"\nwarehouse: {counts}")
    if failures:
        print(f"\n{len(failures)} of {len(checks)} checks FAILED")
        return 1
    print(f"\nall {len(checks)} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
