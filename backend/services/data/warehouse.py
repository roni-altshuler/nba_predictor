"""SQLite-backed game warehouse.

The warehouse is the single source of truth for historical NBA data. Every
external source (ESPN scoreboard, ESPN summary/boxscore, ESPN pickcenter odds)
writes canonical rows here, and every model reads features from joins over
these tables — never from the original JSON caches.

Design choices — ported from the sibling soccer project, and the divergences
are deliberate:

* **Pure stdlib `sqlite3`.** No ORM. Inspectable from the `sqlite3` CLI.
* **Idempotent migrations.** `Warehouse.migrate()` is safe on every process
  start.
* **Upsert semantics** keyed on `game_id`, so re-running a loader cannot
  create duplicates.
* **Team identity is ESPN's integer id, not a name.** This is the single
  biggest simplification over the soccer warehouse, which lost months to a
  fuzzy name resolver splitting one club into two rows. The NBA has 30 stable
  franchises and one source; ESPN's `team.id` survives relocations and
  renames (Seattle SuperSonics and Oklahoma City Thunder are both id 25), so
  there is no fuzzy path to get wrong. Names are stored for display and are
  explicitly NOT a join key.
* **`games` is results-only.** A row here is a fact about a game that was
  played. Scheduled-but-unplayed games live in `scheduled_games`. This
  invariant is what lets every consumer — Elo, the margin model, the feature
  builder, the integrity checker — read a row without a null check, and it is
  guarded by `validate_warehouse_integrity`.

Schema
------
* `teams(team_id, espn_id, display_name, abbreviation, conference, division,
   logo, venue_lat, venue_lon, venue_altitude_m)`
* `team_aliases(alias PRIMARY KEY, team_id)` — historical names
  ("Seattle SuperSonics") resolving to the surviving franchise row
* `competitions(competition_id PRIMARY KEY, name, level)`
* `games(game_id PRIMARY KEY, source, competition_id, season, season_type,
   date_utc, home_team_id, away_team_id, home_score, away_score,
   home_q1..home_q4, away_q1..away_q4, overtimes, neutral_site, venue,
   attendance, phase, series_id, plus box-score columns, plus odds columns)`
* `scheduled_games(...)` — same shape, no scores
* `elo_ratings(team_id, date, elo, PRIMARY KEY(team_id, date))`
* `odds_snapshots(game_id, provider, captured_at, ...)` — append-only
* `prediction_snapshots(fixture_uid, generated_at, model_version, ...)`
* `schema_version(version, applied_at)`
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

WAREHOUSE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "warehouse.sqlite"
)

# v1: teams/games/scheduled_games/elo_ratings/odds_snapshots.
# v2: prediction_snapshots (append-only forecast provenance).
# v3: playoff_series (the bracket layer's resolved ties).
SCHEMA_VERSION = 3

# Season type ids, ESPN's own. Kept as integers because that is what the
# scoreboard payload carries; named here so no call site writes a bare 2.
SEASON_TYPE_PRESEASON = 1
SEASON_TYPE_REGULAR = 2
SEASON_TYPE_POSTSEASON = 3
SEASON_TYPE_ALLSTAR = 4
SEASON_TYPE_PLAY_IN = 5

SEASON_TYPE_NAMES = {
    SEASON_TYPE_PRESEASON: "preseason",
    SEASON_TYPE_REGULAR: "regular-season",
    SEASON_TYPE_POSTSEASON: "post-season",
    SEASON_TYPE_ALLSTAR: "all-star",
    SEASON_TYPE_PLAY_IN: "play-in",
}

_DDL_STATEMENTS: Tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS teams (
        team_id INTEGER PRIMARY KEY AUTOINCREMENT,
        espn_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        short_name TEXT,
        abbreviation TEXT,
        conference TEXT,
        division TEXT,
        logo TEXT,
        venue_name TEXT,
        venue_lat REAL,
        venue_lon REAL,
        venue_altitude_m REAL,
        first_seen TEXT,
        last_seen TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS team_aliases (
        alias TEXT PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS competitions (
        competition_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        level TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        competition_id TEXT NOT NULL REFERENCES competitions(competition_id),
        season INTEGER NOT NULL,
        season_type INTEGER NOT NULL,
        date_utc TEXT NOT NULL,
        home_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        away_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        home_q1 INTEGER, home_q2 INTEGER, home_q3 INTEGER, home_q4 INTEGER,
        away_q1 INTEGER, away_q2 INTEGER, away_q3 INTEGER, away_q4 INTEGER,
        overtimes INTEGER NOT NULL DEFAULT 0,
        neutral_site INTEGER NOT NULL DEFAULT 0,
        venue TEXT,
        attendance INTEGER,
        phase TEXT,
        series_id TEXT,
        -- Box score, home side
        home_fgm REAL, home_fga REAL, home_fg3m REAL, home_fg3a REAL,
        home_ftm REAL, home_fta REAL, home_oreb REAL, home_dreb REAL,
        home_reb REAL, home_ast REAL, home_stl REAL, home_blk REAL,
        home_tov REAL, home_pf REAL,
        -- Box score, away side
        away_fgm REAL, away_fga REAL, away_fg3m REAL, away_fg3a REAL,
        away_ftm REAL, away_fta REAL, away_oreb REAL, away_dreb REAL,
        away_reb REAL, away_ast REAL, away_stl REAL, away_blk REAL,
        away_tov REAL, away_pf REAL,
        -- Closing market, from ESPN pickcenter. moneyline is AMERICAN odds.
        ml_home REAL, ml_away REAL, spread_home REAL, total_points REAL,
        odds_provider TEXT,
        fetched_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scheduled_games (
        game_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        competition_id TEXT NOT NULL REFERENCES competitions(competition_id),
        season INTEGER NOT NULL,
        season_type INTEGER NOT NULL,
        date_utc TEXT NOT NULL,
        home_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        away_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        neutral_site INTEGER NOT NULL DEFAULT 0,
        venue TEXT,
        phase TEXT,
        series_id TEXT,
        ml_home REAL, ml_away REAL, spread_home REAL, total_points REAL,
        odds_provider TEXT,
        fetched_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS elo_ratings (
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        elo REAL NOT NULL,
        PRIMARY KEY (team_id, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS odds_snapshots (
        game_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        ml_home REAL, ml_away REAL, spread_home REAL, spread_odds_home REAL,
        spread_odds_away REAL, total_points REAL, over_odds REAL,
        under_odds REAL,
        before_tipoff INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (game_id, provider, captured_at)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS prediction_snapshots (
        fixture_uid TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        model_version TEXT NOT NULL,
        competition_id TEXT,
        season INTEGER,
        tipoff_utc TEXT,
        home_team TEXT,
        away_team TEXT,
        p_home REAL,
        p_away REAL,
        exp_margin REAL,
        exp_total REAL,
        PRIMARY KEY (fixture_uid, generated_at, model_version)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS playoff_series (
        series_id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL,
        season INTEGER NOT NULL,
        round_slug TEXT NOT NULL,
        depth INTEGER,
        team_a_id INTEGER REFERENCES teams(team_id),
        team_b_id INTEGER REFERENCES teams(team_id),
        wins_a INTEGER NOT NULL DEFAULT 0,
        wins_b INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0,
        best_of INTEGER NOT NULL DEFAULT 7,
        winner_id INTEGER REFERENCES teams(team_id),
        status TEXT NOT NULL DEFAULT 'pending',
        first_game_utc TEXT,
        last_game_utc TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_games_date ON games(date_utc)",
    "CREATE INDEX IF NOT EXISTS idx_games_season ON games(season, season_type)",
    "CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team_id)",
    "CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team_id)",
    "CREATE INDEX IF NOT EXISTS idx_games_series ON games(series_id)",
    "CREATE INDEX IF NOT EXISTS idx_sched_date ON scheduled_games(date_utc)",
    "CREATE INDEX IF NOT EXISTS idx_sched_season ON scheduled_games(season, season_type)",
    "CREATE INDEX IF NOT EXISTS idx_elo_date ON elo_ratings(date)",
    "CREATE INDEX IF NOT EXISTS idx_series_season ON playoff_series(season, competition_id)",
)


# Columns on `games` that a loader may write. Named explicitly so that adding
# a column to the DDL without teaching the writer about it is a visible
# omission rather than a silent NULL.
GAME_COLUMNS: Tuple[str, ...] = (
    "game_id", "source", "competition_id", "season", "season_type", "date_utc",
    "home_team_id", "away_team_id", "home_score", "away_score",
    "home_q1", "home_q2", "home_q3", "home_q4",
    "away_q1", "away_q2", "away_q3", "away_q4",
    "overtimes", "neutral_site", "venue", "attendance", "phase", "series_id",
    "home_fgm", "home_fga", "home_fg3m", "home_fg3a", "home_ftm", "home_fta",
    "home_oreb", "home_dreb", "home_reb", "home_ast", "home_stl", "home_blk",
    "home_tov", "home_pf",
    "away_fgm", "away_fga", "away_fg3m", "away_fg3a", "away_ftm", "away_fta",
    "away_oreb", "away_dreb", "away_reb", "away_ast", "away_stl", "away_blk",
    "away_tov", "away_pf",
    "ml_home", "ml_away", "spread_home", "total_points", "odds_provider",
    "fetched_at",
)

SCHEDULED_COLUMNS: Tuple[str, ...] = (
    "game_id", "source", "competition_id", "season", "season_type", "date_utc",
    "home_team_id", "away_team_id", "neutral_site", "venue", "phase",
    "series_id", "ml_home", "ml_away", "spread_home", "total_points",
    "odds_provider", "fetched_at",
)


@dataclass
class GameRow:
    """One played game, canonicalised.

    `home_score`/`away_score` are required and non-null by construction —
    see the module docstring on why `games` is results-only.
    """

    game_id: str
    source: str
    competition_id: str
    season: int
    season_type: int
    date_utc: str
    home_team_id: int
    away_team_id: int
    home_score: int
    away_score: int
    extra: Dict[str, Any] = field(default_factory=dict)

    def as_params(self) -> Dict[str, Any]:
        row: Dict[str, Any] = {c: None for c in GAME_COLUMNS}
        row.update(
            game_id=self.game_id,
            source=self.source,
            competition_id=self.competition_id,
            season=self.season,
            season_type=self.season_type,
            date_utc=self.date_utc,
            home_team_id=self.home_team_id,
            away_team_id=self.away_team_id,
            home_score=self.home_score,
            away_score=self.away_score,
            overtimes=0,
            neutral_site=0,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        for key, value in self.extra.items():
            if key in row:
                row[key] = value
            else:  # a typo in a loader is a bug, not a column to invent
                raise KeyError(f"{key!r} is not a column on `games`")
        return row


@dataclass
class ScheduledGameRow:
    """One drawn-but-unplayed game."""

    game_id: str
    source: str
    competition_id: str
    season: int
    season_type: int
    date_utc: str
    home_team_id: int
    away_team_id: int
    extra: Dict[str, Any] = field(default_factory=dict)

    def as_params(self) -> Dict[str, Any]:
        row: Dict[str, Any] = {c: None for c in SCHEDULED_COLUMNS}
        row.update(
            game_id=self.game_id,
            source=self.source,
            competition_id=self.competition_id,
            season=self.season,
            season_type=self.season_type,
            date_utc=self.date_utc,
            home_team_id=self.home_team_id,
            away_team_id=self.away_team_id,
            neutral_site=0,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        for key, value in self.extra.items():
            if key in row:
                row[key] = value
            else:
                raise KeyError(f"{key!r} is not a column on `scheduled_games`")
        return row


class Warehouse:
    """Thin, synchronous wrapper around the SQLite game warehouse."""

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else WAREHOUSE_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()

    # ---------------------------------------------------------------- conn

    @property
    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self.path), timeout=30.0)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            self._local.conn = conn
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    # ------------------------------------------------------------ migrate

    def migrate(self) -> int:
        with self.transaction() as conn:
            for stmt in _DDL_STATEMENTS:
                conn.execute(stmt)
            row = conn.execute(
                "SELECT MAX(version) AS v FROM schema_version"
            ).fetchone()
            current = row["v"] if row and row["v"] is not None else 0
            if current < SCHEMA_VERSION:
                conn.execute(
                    "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                    (
                        SCHEMA_VERSION,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    ),
                )
        return SCHEMA_VERSION

    # -------------------------------------------------------------- teams

    def upsert_team(
        self,
        espn_id: str,
        display_name: str,
        *,
        short_name: Optional[str] = None,
        abbreviation: Optional[str] = None,
        conference: Optional[str] = None,
        division: Optional[str] = None,
        logo: Optional[str] = None,
        venue_name: Optional[str] = None,
        seen: Optional[str] = None,
    ) -> int:
        """Insert or update a franchise, keyed on ESPN's stable team id.

        Only non-None arguments overwrite an existing value. A later
        scoreboard row carrying `"Inter"`-style short names must not blank
        out the conference a standings pull established.
        """
        espn_id = str(espn_id)
        with self.transaction() as conn:
            existing = conn.execute(
                "SELECT team_id FROM teams WHERE espn_id = ?", (espn_id,)
            ).fetchone()
            if existing is None:
                cur = conn.execute(
                    """
                    INSERT INTO teams (espn_id, display_name, short_name,
                        abbreviation, conference, division, logo, venue_name,
                        first_seen, last_seen)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """,
                    (espn_id, display_name, short_name, abbreviation,
                     conference, division, logo, venue_name, seen, seen),
                )
                team_id = int(cur.lastrowid)
                conn.execute(
                    "INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)",
                    (_norm(display_name), team_id),
                )
                return team_id

            team_id = int(existing["team_id"])
            sets, params = [], []
            for col, val in (
                ("display_name", display_name),
                ("short_name", short_name),
                ("abbreviation", abbreviation),
                ("conference", conference),
                ("division", division),
                ("logo", logo),
                ("venue_name", venue_name),
            ):
                if val is not None:
                    sets.append(f"{col} = ?")
                    params.append(val)
            if seen:
                sets.append(
                    "first_seen = CASE WHEN first_seen IS NULL OR first_seen > ? "
                    "THEN ? ELSE first_seen END"
                )
                params.extend([seen, seen])
                sets.append(
                    "last_seen = CASE WHEN last_seen IS NULL OR last_seen < ? "
                    "THEN ? ELSE last_seen END"
                )
                params.extend([seen, seen])
            if sets:
                params.append(team_id)
                conn.execute(
                    f"UPDATE teams SET {', '.join(sets)} WHERE team_id = ?", params
                )
            if display_name:
                conn.execute(
                    "INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)",
                    (_norm(display_name), team_id),
                )
            return team_id

    def team_id_for_espn(self, espn_id: str) -> Optional[int]:
        row = self.conn.execute(
            "SELECT team_id FROM teams WHERE espn_id = ?", (str(espn_id),)
        ).fetchone()
        return int(row["team_id"]) if row else None

    def team_id_for_name(self, name: str) -> Optional[int]:
        """Resolve a display name through the alias table only.

        Deliberately exact-after-normalisation: there is no fuzzy path,
        because with 30 franchises and one source there is nothing a fuzzy
        match could buy that an alias row cannot, and a wrong merge here
        would corrupt a franchise's entire record.
        """
        row = self.conn.execute(
            "SELECT team_id FROM team_aliases WHERE alias = ?", (_norm(name),)
        ).fetchone()
        return int(row["team_id"]) if row else None

    def add_alias(self, alias: str, team_id: int) -> None:
        with self.transaction() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)",
                (_norm(alias), team_id),
            )

    def teams(self) -> List[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM teams ORDER BY display_name"))

    # ------------------------------------------------------- competitions

    def upsert_competition(
        self, competition_id: str, name: str, level: Optional[str] = None
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO competitions (competition_id, name, level)
                VALUES (?,?,?)
                ON CONFLICT(competition_id) DO UPDATE SET name=excluded.name,
                    level=COALESCE(excluded.level, competitions.level)
                """,
                (competition_id, name, level),
            )

    # -------------------------------------------------------------- games

    def upsert_games(self, rows: Iterable[GameRow]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        cols = ", ".join(GAME_COLUMNS)
        placeholders = ", ".join(f":{c}" for c in GAME_COLUMNS)
        # COALESCE on update so a scoreboard pass (no box score) cannot blank
        # the box score a later summary pass wrote. Score and date always win
        # from the newest row — a corrected final is a correction.
        updates = ", ".join(
            f"{c}=excluded.{c}"
            if c in {"home_score", "away_score", "date_utc", "season_type",
                     "source", "fetched_at"}
            else f"{c}=COALESCE(excluded.{c}, games.{c})"
            for c in GAME_COLUMNS
            if c != "game_id"
        )
        sql = (
            f"INSERT INTO games ({cols}) VALUES ({placeholders}) "
            f"ON CONFLICT(game_id) DO UPDATE SET {updates}"
        )
        with self.transaction() as conn:
            conn.executemany(sql, [r.as_params() for r in rows])
        return len(rows)

    def upsert_scheduled(self, rows: Iterable[ScheduledGameRow]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        cols = ", ".join(SCHEDULED_COLUMNS)
        placeholders = ", ".join(f":{c}" for c in SCHEDULED_COLUMNS)
        updates = ", ".join(
            f"{c}=excluded.{c}" for c in SCHEDULED_COLUMNS if c != "game_id"
        )
        sql = (
            f"INSERT INTO scheduled_games ({cols}) VALUES ({placeholders}) "
            f"ON CONFLICT(game_id) DO UPDATE SET {updates}"
        )
        with self.transaction() as conn:
            conn.executemany(sql, [r.as_params() for r in rows])
        return len(rows)

    def drop_scheduled(self, game_ids: Sequence[str]) -> int:
        """Remove scheduled rows for games that now have a result.

        A game that has been played must not appear in both tables: every
        consumer of `scheduled_games` treats a row there as "still to come",
        and a stale one puts a played game back into the remaining fixture
        list and double-counts it in the season simulation.
        """
        if not game_ids:
            return 0
        with self.transaction() as conn:
            cur = conn.executemany(
                "DELETE FROM scheduled_games WHERE game_id = ?",
                [(g,) for g in game_ids],
            )
        return cur.rowcount if cur.rowcount and cur.rowcount > 0 else len(game_ids)

    def prune_played_from_scheduled(self) -> int:
        with self.transaction() as conn:
            cur = conn.execute(
                "DELETE FROM scheduled_games WHERE game_id IN (SELECT game_id FROM games)"
            )
            return cur.rowcount or 0

    def iter_games(
        self,
        *,
        seasons: Optional[Sequence[int]] = None,
        season_types: Optional[Sequence[int]] = (SEASON_TYPE_REGULAR,),
        since: Optional[str] = None,
        until: Optional[str] = None,
        competition_id: Optional[str] = None,
    ) -> Iterator[sqlite3.Row]:
        """Yield played games in chronological order.

        Ordering is `(date_utc, game_id)` and every caller that slices the
        result positionally must use this same ordering. The soccer project
        lost a whole benchmark to a split that re-sorted by a different key
        and then indexed positionally into the original.
        """
        where, params = ["1=1"], []
        if seasons:
            where.append(f"season IN ({','.join('?' * len(seasons))})")
            params.extend(seasons)
        if season_types:
            where.append(f"season_type IN ({','.join('?' * len(season_types))})")
            params.extend(season_types)
        if since:
            where.append("date_utc >= ?")
            params.append(since)
        if until:
            where.append("date_utc <= ?")
            params.append(until)
        if competition_id:
            where.append("competition_id = ?")
            params.append(competition_id)
        sql = (
            f"SELECT * FROM games WHERE {' AND '.join(where)} "
            f"ORDER BY date_utc, game_id"
        )
        yield from self.conn.execute(sql, params)

    def iter_scheduled(
        self,
        *,
        seasons: Optional[Sequence[int]] = None,
        season_types: Optional[Sequence[int]] = None,
        since: Optional[str] = None,
    ) -> Iterator[sqlite3.Row]:
        where, params = ["1=1"], []
        if seasons:
            where.append(f"season IN ({','.join('?' * len(seasons))})")
            params.extend(seasons)
        if season_types:
            where.append(f"season_type IN ({','.join('?' * len(season_types))})")
            params.extend(season_types)
        if since:
            where.append("date_utc >= ?")
            params.append(since)
        sql = (
            f"SELECT * FROM scheduled_games WHERE {' AND '.join(where)} "
            f"ORDER BY date_utc, game_id"
        )
        yield from self.conn.execute(sql, params)

    # ---------------------------------------------------------------- elo

    def write_elo(self, rows: Iterable[Tuple[int, str, float]]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        with self.transaction() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO elo_ratings (team_id, date, elo) VALUES (?,?,?)",
                rows,
            )
        return len(rows)

    def latest_elo(self, team_id: int, before: Optional[str] = None) -> Optional[float]:
        """The last rating strictly BEFORE `before`.

        Ratings are POST-game values timestamped at tipoff, so "strictly
        earlier" is what makes a feature point-in-time correct. Using `<=`
        here leaks the result of the game being predicted.
        """
        if before:
            row = self.conn.execute(
                "SELECT elo FROM elo_ratings WHERE team_id = ? AND date < ? "
                "ORDER BY date DESC LIMIT 1",
                (team_id, before),
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT elo FROM elo_ratings WHERE team_id = ? "
                "ORDER BY date DESC LIMIT 1",
                (team_id,),
            ).fetchone()
        return float(row["elo"]) if row else None

    # ------------------------------------------------------------- counts

    def counts(self) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for table in (
            "teams", "competitions", "games", "scheduled_games",
            "elo_ratings", "odds_snapshots", "prediction_snapshots",
            "playoff_series",
        ):
            try:
                row = self.conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
                out[table] = int(row["n"])
            except sqlite3.OperationalError:
                out[table] = 0
        return out

    def season_summary(self) -> List[sqlite3.Row]:
        return list(
            self.conn.execute(
                """
                SELECT season, season_type, COUNT(*) AS games,
                       COUNT(ml_home) AS priced,
                       MIN(date_utc) AS first, MAX(date_utc) AS last
                FROM games GROUP BY season, season_type
                ORDER BY season, season_type
                """
            )
        )


def _norm(name: str) -> str:
    """Normalise a franchise name for the alias table.

    Lowercase, collapse whitespace, drop punctuation. Deliberately does NOT
    strip city or nickname tokens: `Los Angeles Lakers` and `Los Angeles
    Clippers` share a city and must never collide.
    """
    import re
    import unicodedata

    text = unicodedata.normalize("NFKD", name or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^\w\s]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


_warehouse: Optional[Warehouse] = None


def get_warehouse(path: Optional[Path] = None) -> Warehouse:
    global _warehouse
    if _warehouse is None or (path is not None and Path(path) != _warehouse.path):
        _warehouse = Warehouse(path)
        _warehouse.migrate()
    return _warehouse
