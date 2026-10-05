"""ESPN API client for NBA data.

Provides live scores, box scores, standings, team metadata and — critically —
the sportsbook lines in `pickcenter`, which are this project's market
benchmark.

Two things about this host are load-bearing and are inherited verbatim from
the sibling soccer project, where they each cost a production outage:

1. **Use `site.web.api.espn.com`, never `site.api.espn.com`.** The two serve
   byte-identical payloads. Akamai answers `site.api` with 403 Access Denied
   from datacentre IPs (Vercel, GitHub Actions) and its error page carries no
   CORS headers, so a browser fetch dies with `net::ERR_FAILED`. The host is
   named once here and once in `src/lib/espnHost.ts`. Do not hardcode it
   anywhere else.

2. **The scoreboard silently caps at a page of events.** No error, no field
   saying so. Any call spanning more than a couple of days must pass an
   explicit `limit`, or it returns a prefix of the range and nothing says so.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import httpx

from backend.services.data.placeholders import is_placeholder_team

logger = logging.getLogger(__name__)

# ESPN's own sport/league slugs. `nba` is the only league this project serves;
# the others are named so a future wave does not have to rediscover them.
ESPN_LEAGUE_IDS = {
    "nba": "basketball/nba",
    "wnba": "basketball/wnba",
    "mens_college": "basketball/mens-college-basketball",
}

# The competition ids used inside the warehouse. Kept distinct from ESPN's
# slug so a source change does not rewrite every row.
NBA_COMPETITION_ID = "nba"
NBA_PLAYOFFS_COMPETITION_ID = "nba.playoffs"
NBA_CUP_COMPETITION_ID = "nba.cup"


class ESPNUnavailable(RuntimeError):
    """A failed fetch is not evidence of an empty scoreboard."""

    def __init__(self, message: str, *, range_unsupported: bool = False):
        super().__init__(message)
        self.range_unsupported = range_unsupported


def _valid_scoreboard_team(team: Any, *, pending: bool) -> bool:
    if not isinstance(team, dict):
        return False
    team_id = team.get("id")
    if isinstance(team_id, bool) or not isinstance(team_id, (str, int)):
        return False
    text = str(team_id)
    if not text.isascii():
        return False
    if text.isdigit():
        return True
    # ESPN's unplayed Cup slots use -1/-2 with explicit TBD names. Keep
    # them visible to the loader's skip count, without accepting corrupt
    # franchise IDs or relaxing validation of missing metadata.
    return (pending and text.startswith("-") and text[1:].isdigit()
            and int(text) < 0 and is_placeholder_team(team))


def validate_scoreboard(data: Any) -> None:
    """Validate the fields the loader needs before caching or writing rows."""
    if not isinstance(data, dict) or not isinstance(data.get("events"), list):
        raise ESPNUnavailable("ESPN scoreboard must contain an events array")
    if data.get("error") or (isinstance(data.get("code"), int) and data["code"] >= 400):
        raise ESPNUnavailable("ESPN scoreboard contains a provider error")
    for event in data["events"]:
        if not isinstance(event, dict):
            raise ESPNUnavailable("ESPN scoreboard contains a non-object event")
        event_id = event.get("id")
        if (isinstance(event_id, bool) or not isinstance(event_id, (str, int))
                or not str(event_id).isascii() or not str(event_id).isdigit()
                or int(event_id) <= 0):
            raise ESPNUnavailable("ESPN scoreboard contains an invalid event id")
        try:
            date = datetime.fromisoformat(event["date"].replace("Z", "+00:00"))
            season = event["season"]
            competition = event["competitions"][0]
            status = (event.get("status") or competition["status"])["type"]
            sides = competition["competitors"]
            valid = (
                date.tzinfo is not None
                and type(season["year"]) is int and season["year"] > 0
                and type(season["type"]) is int and season["type"] > 0
                and status["state"] in {"pre", "in", "post"}
                and type(status["completed"]) is bool
                and isinstance(status["name"], str)
                and len(sides) == 2
                and {side["homeAway"] for side in sides} == {"home", "away"}
                and all(
                    _valid_scoreboard_team(
                        side["team"],
                        pending=status["state"] == "pre" and status["completed"] is False,
                    )
                    for side in sides
                )
            )
            abandoned = any(token in status["name"] for token in (
                "POSTPONED", "CANCELED", "CANCELLED", "SUSPENDED", "FORFEIT"
            ))
            if status["state"] == "post" and status["completed"] and not abandoned:
                valid = valid and all(
                    not isinstance(side.get("score"), bool)
                    and isinstance(side.get("score"), (str, int))
                    and str(side["score"]).isascii() and str(side["score"]).isdigit()
                    for side in sides
                )
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            valid = False
        if not valid:
            raise ESPNUnavailable(f"ESPN event {event_id} has invalid loader fields")


class RateLimiter:
    """Token bucket rate limiter."""

    def __init__(self, requests_per_minute: int = 60):
        self.rate = requests_per_minute / 60.0
        self.tokens = float(requests_per_minute)
        self.max_tokens = float(requests_per_minute)
        self.last_update = time.time()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(self.max_tokens, self.tokens + elapsed * self.rate)
            self.last_update = now
            if self.tokens < 1:
                await asyncio.sleep((1 - self.tokens) / self.rate)
                self.tokens = 0.0
            else:
                self.tokens -= 1


class SimpleCache:
    """In-memory cache with TTL."""

    def __init__(self) -> None:
        self._cache: Dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[Any]:
        if key in self._cache:
            value, expiry = self._cache[key]
            if time.time() < expiry:
                return value
            del self._cache[key]
        return None

    def set(self, key: str, value: Any, ttl: int = 300) -> None:
        self._cache[key] = (value, time.time() + ttl)

    def clear(self) -> None:
        self._cache.clear()


class ESPNClient:
    """ESPN API client for NBA data."""

    HOST = "https://site.web.api.espn.com"
    BASE_URL = f"{HOST}/apis/site/v2/sports/basketball/nba"
    V2_STANDINGS_URL = f"{HOST}/apis/v2/sports/basketball/nba/standings"
    CORE_URL = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def __init__(self, requests_per_minute: int = 60):
        self.rate_limiter = RateLimiter(requests_per_minute)
        self.cache = SimpleCache()
        self.default_ttl = 300
        self.live_ttl = 30
        self._client: Optional[httpx.AsyncClient] = None
        self._client_loop: Optional[asyncio.AbstractEventLoop] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client.

        Recreated when the running event loop changes: sync entry points
        (CLI scripts, simulators) each spin up their own short-lived loop, and
        an AsyncClient bound to a closed loop fails every request with
        "Event loop is closed" without ever reporting itself as closed.
        """
        loop = asyncio.get_running_loop()
        if self._client is None or self._client.is_closed or self._client_loop is not loop:
            self._client = httpx.AsyncClient(
                headers=self.HEADERS, timeout=30.0, follow_redirects=True
            )
            self._client_loop = loop
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _request(
        self,
        endpoint: str,
        params: Optional[Dict] = None,
        cache_key: Optional[str] = None,
        cache_ttl: Optional[int] = None,
        retries: int = 3,
        strict: bool = False,
        validate: Optional[Callable[[Any], None]] = None,
    ) -> Optional[Dict]:
        if cache_key:
            cached = self.cache.get(cache_key)
            if cached is not None:
                if validate:
                    validate(cached)
                return cached

        url = endpoint if endpoint.startswith("http") else f"{self.BASE_URL}/{endpoint}"

        for attempt in range(retries):
            await self.rate_limiter.acquire()
            try:
                client = await self._get_client()
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                if validate:
                    validate(data)
                if cache_key:
                    self.cache.set(cache_key, data, cache_ttl or self.default_ttl)
                return data
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                # 404 is an answer ("no such event"), not a transient failure.
                if status == 404 and not strict:
                    return None
                logger.warning("ESPN HTTP %s for %s (attempt %d)", status, url, attempt + 1)
                if 400 <= status < 500 and status != 429:
                    if strict:
                        try:
                            error = exc.response.json()
                        except ValueError:
                            error = None
                        # Observed on site.web's scoreboard range queries.
                        # An unrelated 400, auth failure, or outage is never
                        # permission to fan out into hundreds of requests.
                        unsupported = (
                            isinstance(error, dict) and error.get("code") == 400
                            and error.get("message") == "Failed to get events endpoint."
                            and status == 400
                        )
                        raise ESPNUnavailable(
                            f"ESPN HTTP {status} for {url}", range_unsupported=unsupported
                        ) from exc
                    return None
            except ESPNUnavailable:
                raise
            except httpx.RequestError as exc:
                logger.warning("ESPN request error for %s: %s", url, exc)
            except ValueError as exc:
                if strict:
                    raise ESPNUnavailable(f"ESPN invalid JSON for {url}") from exc
                return None
            except Exception as exc:  # noqa: BLE001 - last-resort guard
                logger.warning("ESPN unexpected error for %s: %s", url, exc)
            if attempt < retries - 1:
                await asyncio.sleep(1.5 * (attempt + 1))
        logger.error("ESPN gave up on %s after %d attempts", url, retries)
        if strict:
            raise ESPNUnavailable(f"ESPN unavailable after {retries} attempts for {url}")
        return None

    # ------------------------------------------------------- scoreboard

    async def get_scoreboard(
        self,
        dates: Optional[str] = None,
        *,
        limit: int = 1000,
        season_type: Optional[int] = None,
        use_cache: bool = True,
    ) -> Dict:
        """Scoreboard for a date or an inclusive `YYYYMMDD-YYYYMMDD` range.

        `limit` is passed on EVERY call, never left to the default: ESPN
        truncates silently and a truncated season looks exactly like a short
        one.
        """
        if limit < 1:
            raise ValueError("limit must be positive")

        def validate_payload(data: Any) -> None:
            validate_scoreboard(data)
            if len(data["events"]) >= limit:
                raise ESPNUnavailable(f"ESPN scoreboard at limit {limit}; coverage may be truncated")

        params: Dict[str, Any] = {"limit": limit}
        if dates:
            params["dates"] = dates
        if season_type is not None:
            params["seasontype"] = season_type
        key = f"nba_sb_{dates or 'today'}_{limit}_{season_type}" if use_cache else None
        data = await self._request(
            "scoreboard", params, key, self.live_ttl if not dates else self.default_ttl,
            strict=True, validate=validate_payload,
        )
        if data is None:
            raise ESPNUnavailable("ESPN scoreboard unavailable")
        return data

    async def get_scoreboard_range(
        self,
        start: datetime,
        end: datetime,
        *,
        chunk_days: int = 14,
        limit: int = 1000,
        use_cache: bool = False,
    ) -> List[Dict]:
        """Every event between two dates, fetched in chunks.

        Chunked because the cap is on events per response, not on the range:
        a busy NBA fortnight is ~110 games, comfortably inside one page, while
        a whole season is not. Returns raw ESPN event dicts, de-duplicated on
        event id. Tokens are ESPN's Eastern calendar days, not UTC tip-offs.
        If this host rejects ranges with its known 400 contract, use one
        request per day for the remainder of this call. No partial result is
        returned if any request fails or reaches the page limit.
        """
        if chunk_days < 1 or limit < 1 or start.date() > end.date():
            raise ValueError("chunk_days/limit must be positive and start must precede end")
        seen: Dict[str, Dict] = {}
        cursor = start.date()
        daily = chunk_days == 1
        while cursor <= end.date():
            chunk_end = min(cursor + timedelta(days=0 if daily else chunk_days - 1), end.date())
            token = (f"{cursor:%Y%m%d}" if cursor == chunk_end
                     else f"{cursor:%Y%m%d}-{chunk_end:%Y%m%d}")
            try:
                data = await self.get_scoreboard(token, limit=limit, use_cache=use_cache)
            except ESPNUnavailable as exc:
                if exc.range_unsupported and cursor != chunk_end and not daily:
                    logger.warning("ESPN rejected date range %s; switching to daily queries", token)
                    daily = True
                    continue
                raise
            validate_scoreboard(data)
            events = data["events"]
            if len(events) >= limit:
                raise ESPNUnavailable(
                    f"ESPN returned {len(events)} events for {token} at limit {limit}; "
                    "coverage may be truncated"
                )
            for event in events:
                seen[str(event["id"])] = event
            cursor = chunk_end + timedelta(days=1)
        return list(seen.values())

    async def get_summary(self, event_id: str, use_cache: bool = True) -> Optional[Dict]:
        """Full game detail: box score, plays, odds, win probability."""
        return await self._request(
            "summary",
            {"event": event_id},
            f"nba_summary_{event_id}" if use_cache else None,
            self.live_ttl,
        )

    # -------------------------------------------------------- standings

    async def get_standings(self, season: Optional[int] = None) -> Optional[Dict]:
        """Conference standings.

        ESPN quietly emptied the site/v2 standings endpoint for some sports;
        the apis/v2 host serves the children/entries/stats structure the
        conference builder needs, so that is what is asked first here.
        """
        params = {"season": season} if season else None
        data = await self._request(
            self.V2_STANDINGS_URL,
            params,
            f"nba_standings_{season or 'current'}",
            600,
        )
        if data and data.get("children"):
            return data
        return await self._request(
            "standings", params, f"nba_standings_site_{season or 'current'}", 600
        )

    # ------------------------------------------------------------ teams

    async def get_teams(self) -> List[Dict]:
        data = await self._request("teams", {"limit": 50}, "nba_teams", 3600)
        if not data:
            return []
        leagues = (data.get("sports") or [{}])[0].get("leagues") or [{}]
        return [entry.get("team", {}) for entry in (leagues[0].get("teams") or [])]

    async def get_team(self, team_id: str) -> Optional[Dict]:
        return await self._request(f"teams/{team_id}", cache_key=f"nba_team_{team_id}")

    async def get_team_schedule(self, team_id: str, season: Optional[int] = None) -> List[Dict]:
        params = {"season": season} if season else None
        data = await self._request(
            f"teams/{team_id}/schedule", params, f"nba_team_sched_{team_id}_{season}"
        )
        return (data or {}).get("events") or []

    async def get_news(self, limit: int = 10) -> List[Dict]:
        data = await self._request("news", {"limit": limit}, f"nba_news_{limit}", 900)
        return (data or {}).get("articles") or []


_client: Optional[ESPNClient] = None


def get_espn_client() -> ESPNClient:
    global _client
    if _client is None:
        _client = ESPNClient()
    return _client


async def cleanup_espn_client() -> None:
    global _client
    if _client:
        await _client.close()
        _client = None


def season_bounds(season: int) -> tuple[datetime, datetime]:
    """Calendar window that contains an NBA season.

    ESPN labels a season by the year it ENDS: the 2025-26 season is `2026`.
    The window runs from 1 September of the previous calendar year (catching
    preseason) to 31 July (catching a late Finals or a suspended-season
    restart such as 2020's August-October bubble).
    """
    start = datetime(season - 1, 9, 1, tzinfo=timezone.utc)
    end = datetime(season, 10, 31, tzinfo=timezone.utc) if season == 2020 else datetime(
        season, 7, 31, tzinfo=timezone.utc
    )
    return start, end


def current_season(today: Optional[datetime] = None) -> int:
    """The season a forecast should be ABOUT, on ESPN's end-year convention.

    The rollover is **July, not September**, and that is the whole point.
    The NBA Finals end in mid-to-late June, so from July onward the season
    carrying that label is finished and the only season anyone wants a
    forecast for is the next one. A September rollover — which is what the
    calendar-year convention suggests — makes every run between July and
    September publish projections for a season that has already been
    decided, complete with 100% playoff probabilities for teams that were
    eliminated months ago.

    Preseason games in early October and a late Finals in July both sit
    inside `season_bounds`, which is deliberately wider than this; the two
    functions answer different questions and must not be collapsed.
    """
    now = today or datetime.now(timezone.utc)
    return now.year + 1 if now.month >= 7 else now.year
