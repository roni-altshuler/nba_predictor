"""Backfill sportsbook lines and vendor forecasts from ESPN's `pickcenter`.

    python3 -m backend.scripts.backfill_odds --seasons 2016-2026
    python3 -m backend.scripts.backfill_odds --missing-only --concurrency 16

ESPN puts the betting block on the **summary** endpoint, never on the
scoreboard, so this costs one request per game. At ~30 requests/second that
is a few minutes for the whole modern era.

**`pickcenter` mixes two completely different kinds of number, and merging
them would destroy the benchmark.** Measured against the live API on
2026-08-15:

| era | providers |
|---|---|
| ≤2013 | none |
| 2016 | `consensus`, `numberfire`, `teamrankings` |
| 2019 | `numberfire`, `teamrankings` — no market at all |
| 2023 | `consensus`, `teamrankings` |
| 2026 | `DraftKings` |

`consensus` and a named sportsbook are **prices** — someone is offering to
take the other side, which is what makes a market benchmark meaningful.
`numberfire` and `teamrankings` are **public model forecasts**: nobody is
risking anything on them, and they are the NBA analogue of the soccer
project's bought vendor forecast. Scoring ourselves against a model and
calling it "the market" would be a category error that flatters or punishes
us for no defensible reason, so the two land in different columns:

* market → `games.ml_home` / `ml_away` / `spread_home` / `total_points`
* vendor → `odds_snapshots` under the vendor's own provider name

**A backfilled line is NOT a closing line, and this script does not pretend
otherwise.** Asking ESPN today for a game played in 2016 returns whatever
number it kept, with no timestamp saying when it was current. Every row is
written with `before_tipoff = 0` in `odds_snapshots`, and the historical
market benchmark is explicitly labelled a *retrospective* comparison. The
forward-captured, provably-pre-tipoff record is a different table built by
`capture_odds.py`, exactly as the soccer project keeps its historical
walk-forward and its live published record in separate blocks that are
never merged.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from backend.services.data.warehouse import Warehouse, get_warehouse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("backfill_odds")

SUMMARY_URL = (
    "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary"
)

# Providers whose number is a PRICE. Lowercased for comparison. Anything not
# in here and not in VENDOR_PROVIDERS is logged and skipped rather than
# guessed at — a new provider silently treated as a market would corrupt the
# benchmark without moving any test.
MARKET_PROVIDERS = {
    "consensus",
    "draftkings",
    "espn bet",
    "espnbet",
    "caesars sportsbook",
    "caesars",
    "bet365",
    "william hill",
    "westgate",
    "unibet",
    "fanduel",
    "betmgm",
    "pointsbet",
    "sugarhouse",
}

# Providers whose number is a MODEL FORECAST. Kept, scored, never used as the
# benchmark.
VENDOR_PROVIDERS = {"numberfire", "teamrankings", "espn bpi", "bpi"}


class OddsBackfiller:
    def __init__(self, warehouse: Warehouse, concurrency: int = 16):
        self.wh = warehouse
        self.concurrency = concurrency
        self.unknown_providers: Dict[str, int] = {}

    async def fetch(self, client: httpx.AsyncClient, game_id: str) -> Optional[Dict]:
        for attempt in range(3):
            try:
                response = await client.get(SUMMARY_URL, params={"event": game_id})
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                return response.json()
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    logger.debug("giving up on %s: %s", game_id, exc)
                    return None
                await asyncio.sleep(1.0 * (attempt + 1))
        return None

    def parse(
        self, game_id: str, payload: Dict[str, Any], home_espn_id: str
    ) -> Tuple[Optional[Dict], List[Tuple]]:
        """Split a pickcenter block into one market row and N vendor rows."""
        entries = payload.get("pickcenter") or []
        market: Optional[Dict] = None
        vendor_rows: List[Tuple] = []
        captured = datetime.now(timezone.utc).isoformat(timespec="seconds")

        for entry in entries:
            provider = ((entry.get("provider") or {}).get("name") or "").strip()
            key = provider.lower()
            record = _line(entry, home_espn_id)
            if record is None:
                continue

            if key in MARKET_PROVIDERS:
                # Priority orders books; `consensus` has priority 0 but is the
                # better benchmark when no book is present. First market row
                # wins, and books sort ahead of consensus below.
                if market is None or _rank(key) < _rank(market["_key"]):
                    market = {**record, "provider": provider, "_key": key}
            elif key in VENDOR_PROVIDERS:
                vendor_rows.append(
                    (
                        game_id,
                        provider,
                        captured,
                        record["ml_home"],
                        record["ml_away"],
                        record["spread_home"],
                        None,
                        None,
                        record["total_points"],
                        None,
                        None,
                        0,  # before_tipoff: a backfilled row cannot prove it
                    )
                )
            elif provider:
                self.unknown_providers[provider] = (
                    self.unknown_providers.get(provider, 0) + 1
                )
        return market, vendor_rows

    async def run(self, games: Sequence[Tuple[str, str]]) -> Dict[str, int]:
        """Fetch and write in batches.

        Batched rather than one big write at the end: a run over the whole
        era is ~11 minutes, and an interrupted run that has written nothing
        is indistinguishable from one that was never started. Flushing as it
        goes also makes `--missing-only` a genuine resume.
        """
        semaphore = asyncio.Semaphore(self.concurrency)
        market_updates: List[Tuple] = []
        vendor_rows: List[Tuple] = []
        totals = {"market": 0, "vendor": 0}
        done = 0

        async with httpx.AsyncClient(
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            timeout=30.0,
            follow_redirects=True,
        ) as client:

            async def one(game_id: str, home_espn_id: str) -> None:
                nonlocal done
                async with semaphore:
                    payload = await self.fetch(client, game_id)
                done += 1
                if done % 2000 == 0:
                    logger.info("  %d/%d fetched", done, len(games))
                if not payload:
                    return
                market, vendors = self.parse(game_id, payload, home_espn_id)
                if market:
                    market_updates.append(
                        (
                            market["ml_home"],
                            market["ml_away"],
                            market["spread_home"],
                            market["total_points"],
                            market["provider"],
                            game_id,
                        )
                    )
                vendor_rows.extend(vendors)

            batch = 500
            for start in range(0, len(games), batch):
                chunk = games[start : start + batch]
                await asyncio.gather(*(one(g, h) for g, h in chunk))
                totals["market"] += self._flush_market(market_updates)
                totals["vendor"] += self._flush_vendor(vendor_rows)

        return {"fetched": done, **totals}

    def _flush_market(self, rows: List[Tuple]) -> int:
        if not rows:
            return 0
        with self.wh.transaction() as conn:
            conn.executemany(
                "UPDATE games SET ml_home=?, ml_away=?, spread_home=?, "
                "total_points=?, odds_provider=? WHERE game_id=?",
                rows,
            )
        written = len(rows)
        rows.clear()
        return written

    def _flush_vendor(self, rows: List[Tuple]) -> int:
        if not rows:
            return 0
        with self.wh.transaction() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO odds_snapshots (game_id, provider, "
                "captured_at, ml_home, ml_away, spread_home, spread_odds_home, "
                "spread_odds_away, total_points, over_odds, under_odds, "
                "before_tipoff) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
        written = len(rows)
        rows.clear()
        return written


def _rank(key: str) -> int:
    """A real book beats a consensus; a consensus beats nothing."""
    return 1 if key == "consensus" else 0


def _line(entry: Dict[str, Any], home_espn_id: str) -> Optional[Dict[str, Any]]:
    """Normalise one pickcenter entry, orienting the spread to the HOME side.

    ESPN's `spread` is signed against the favourite named in `details`, and
    `homeTeamOdds` / `awayTeamOdds` carry the team ref. Reading `spread`
    without checking who it belongs to flips the sign on every away favourite
    — half the corpus — and the error is invisible because the number still
    looks like a plausible spread.
    """
    home_odds = entry.get("homeTeamOdds") or {}
    away_odds = entry.get("awayTeamOdds") or {}
    ml_home = _f(home_odds.get("moneyLine"))
    ml_away = _f(away_odds.get("moneyLine"))
    spread = _f(entry.get("spread"))
    total = _f(entry.get("overUnder"))

    if spread is not None:
        # ESPN publishes `spread` from the home team's perspective in the
        # modern payload, but older rows sign it against the favourite. When
        # the favourite flags disagree with the sign, trust the flags.
        home_favourite = bool(home_odds.get("favorite"))
        if home_favourite and spread > 0:
            spread = -spread
        elif (not home_favourite) and away_odds.get("favorite") and spread < 0:
            spread = -spread

    if ml_home is None and ml_away is None and spread is None and total is None:
        return None
    return {
        "ml_home": ml_home,
        "ml_away": ml_away,
        "spread_home": spread,
        "total_points": total,
    }


def _f(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def run_cli(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", help="e.g. 2016-2026")
    parser.add_argument("--missing-only", action="store_true",
                        help="skip games that already carry a market line")
    parser.add_argument("--concurrency", type=int, default=16)
    parser.add_argument("--limit", type=int, help="stop after N games (smoke test)")
    parser.add_argument("--season-types", default="2,3,5",
                        help="comma-separated ESPN season types")
    args = parser.parse_args(argv)

    warehouse = get_warehouse()
    where = ["1=1"]
    params: List[Any] = []
    if args.seasons:
        from backend.scripts.build_warehouse import parse_seasons

        seasons = parse_seasons(args.seasons)
        where.append(f"g.season IN ({','.join('?' * len(seasons))})")
        params.extend(seasons)
    types = [int(t) for t in args.season_types.split(",") if t.strip()]
    where.append(f"g.season_type IN ({','.join('?' * len(types))})")
    params.extend(types)
    if args.missing_only:
        where.append("g.ml_home IS NULL AND g.spread_home IS NULL")

    sql = (
        "SELECT g.game_id, t.espn_id FROM games g "
        "JOIN teams t ON t.team_id = g.home_team_id "
        f"WHERE {' AND '.join(where)} ORDER BY g.date_utc DESC"
    )
    rows = list(warehouse.conn.execute(sql, params))
    games = [(r["game_id"], r["espn_id"]) for r in rows]
    if args.limit:
        games = games[: args.limit]

    logger.info("backfilling odds for %d games (concurrency %d)",
                len(games), args.concurrency)
    backfiller = OddsBackfiller(warehouse, args.concurrency)
    stats = await backfiller.run(games)
    logger.info("done: %s", stats)
    if backfiller.unknown_providers:
        logger.warning(
            "UNKNOWN providers seen (classify them in MARKET_PROVIDERS or "
            "VENDOR_PROVIDERS before trusting a benchmark that includes them): %s",
            backfiller.unknown_providers,
        )
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return asyncio.run(run_cli(argv))


if __name__ == "__main__":
    sys.exit(main())
