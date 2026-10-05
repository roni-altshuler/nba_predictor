"""Build (or refresh) the NBA game warehouse from ESPN.

    python3 -m backend.scripts.build_warehouse --seasons 2016-2026
    python3 -m backend.scripts.build_warehouse --current-season
    python3 -m backend.scripts.build_warehouse --current-season --with-odds

Ingest uses ESPN's Eastern calendar days and de-duplicates on event id.
Ranges cost roughly 25 requests per season where supported; the verified
range rejection falls back to daily requests, bounded by the season window.
All fetches must succeed before any warehouse rows are updated.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import List, Optional, Sequence

from backend.services.data.espn_loader import ESPNLoader
from backend.services.data.ingestion import STATUS_PATH, record_status
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
    # Include future days: their scheduled games feed the season projection.
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
    parser.add_argument("--status-file", type=Path, default=STATUS_PATH)
    args = parser.parse_args(argv)
    if args.chunk_days < 1:
        parser.error("--chunk-days must be positive")

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
    if not seasons:
        parser.error("--seasons must select at least one season")

    warehouse: Warehouse = get_warehouse(args.db) if args.db else get_warehouse()
    client = get_espn_client()

    try:
        teams = await client.get_teams()
        standings = await client.get_standings()
        # Do not leave a partially refreshed corpus if a later date or
        # season is unavailable. No loader exists until all fetches succeed.
        fetched = {}
        for season in seasons:
            start, end = season_bounds(season)
            fetched[season] = await client.get_scoreboard_range(
                start, end, chunk_days=args.chunk_days, limit=1000
            )
        totals = {"games": 0, "scheduled": 0, "skipped": 0}
        with warehouse.transaction():
            loader = ESPNLoader(warehouse)
            registered = loader.register_teams(teams)
            logger.info("registered %d franchises", registered)
            if standings:
                logger.info("conference membership set for %d teams",
                            loader.apply_standings(standings))
            for season, events in fetched.items():
                stats = loader.load_events(events)
                logger.info("season %s: %d events → %s", season, len(events), stats)
                for key in totals:
                    totals[key] += stats[key]
        record_status(args.status_file, seasons=seasons, status="ok",
                      event_count=sum(map(len, fetched.values())), stats=totals)
    except Exception as exc:
        # This also covers loader/write errors: the outer transaction rolls
        # every nested write back, preserving results and forecast snapshots.
        logger.error("Ingestion failed; publication must stop: %s", exc)
        record_status(args.status_file, seasons=seasons, status="unavailable",
                      event_count=None, error=str(exc))
        return 1
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
