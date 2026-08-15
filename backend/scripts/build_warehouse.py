"""Build (or refresh) the NBA game warehouse from ESPN.

    python3 -m backend.scripts.build_warehouse --seasons 2016-2026
    python3 -m backend.scripts.build_warehouse --current-season
    python3 -m backend.scripts.build_warehouse --current-season --with-odds

Ingest is chunked by date range with a one-day overlap and de-duplicated on
ESPN's event id — see `espn_loader` for why a UTC date is not an ESPN date.

The full history is ~1,320 games a season, which comfortably fits inside the
scoreboard's page limit at a fortnight per request, so a season costs roughly
25 requests and the whole modern era costs a few hundred.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Sequence

from backend.services.data.espn_loader import ESPNLoader
from backend.services.data.warehouse import Warehouse, get_warehouse
from backend.services.espn.client import (
    ESPNClient,
    current_season,
    get_espn_client,
    season_bounds,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("build_warehouse")

# The first season this project claims. ESPN answers earlier ones, but box
# scores thin out and the three-point era before the 2000s is a different
# sport for modelling purposes. Recorded rather than assumed so raising it
# later is a decision, not a drift.
EARLIEST_SEASON = 2004


def parse_seasons(spec: str) -> List[int]:
    """`2016-2026` or `2016,2018,2020` → a list of season labels."""
    out: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, _, hi = part.partition("-")
            out.extend(range(int(lo), int(hi) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))


async def ingest_season(
    client: ESPNClient, loader: ESPNLoader, season: int, *, chunk_days: int
) -> dict:
    start, end = season_bounds(season)
    # Never ask for the future: a range that runs past today returns the
    # schedule, which is correct, but the log line should say so.
    events = await client.get_scoreboard_range(
        start, end, chunk_days=chunk_days, limit=1000
    )
    stats = loader.load_events(events)
    logger.info(
        "season %s: %d events → %d games, %d scheduled, %d skipped",
        season,
        len(events),
        stats["games"],
        stats["scheduled"],
        stats["skipped"],
    )
    return stats


async def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", help="e.g. 2016-2026 or 2019,2021")
    parser.add_argument(
        "--current-season", action="store_true", help="refresh the season in progress"
    )
    parser.add_argument(
        "--all", action="store_true", help=f"every season from {EARLIEST_SEASON}"
    )
    parser.add_argument("--chunk-days", type=int, default=14)
    parser.add_argument("--db", help="warehouse path override")
    args = parser.parse_args(argv)

    seasons: List[int]
    if args.seasons:
        seasons = parse_seasons(args.seasons)
    elif args.current_season:
        seasons = [current_season()]
    elif args.all:
        seasons = list(range(EARLIEST_SEASON, current_season() + 1))
    else:
        parser.error("one of --seasons / --current-season / --all is required")
        return 2

    warehouse: Warehouse = get_warehouse(args.db) if args.db else get_warehouse()
    loader = ESPNLoader(warehouse)
    client = get_espn_client()

    try:
        teams = await client.get_teams()
        registered = loader.register_teams(teams)
        logger.info("registered %d franchises", registered)

        standings = await client.get_standings()
        if standings:
            logger.info("conference membership set for %d teams",
                        loader.apply_standings(standings))

        totals = {"games": 0, "scheduled": 0, "skipped": 0}
        for season in seasons:
            stats = await ingest_season(
                client, loader, season, chunk_days=args.chunk_days
            )
            for key in totals:
                totals[key] += stats[key]
    finally:
        await client.close()

    counts = warehouse.counts()
    logger.info("TOTAL written: %s", totals)
    logger.info("warehouse now holds: %s", counts)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return asyncio.run(run(argv))


if __name__ == "__main__":
    sys.exit(main())
