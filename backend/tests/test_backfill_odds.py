"""Keep ESPN sportsbook aliases separate from forecasts and unknown labels."""

import pytest

from backend.scripts.backfill_odds import OddsBackfiller
from backend.services.data.warehouse import GameRow, Warehouse


@pytest.fixture
def backfiller(tmp_path):
    warehouse = Warehouse(tmp_path / "odds.sqlite")
    warehouse.migrate()
    yield OddsBackfiller(warehouse)
    warehouse.close()


def _entry(provider, **line):
    return {
        "provider": {"name": provider},
        "spread": -5.5,
        "overUnder": 220.5,
        "homeTeamOdds": {"moneyLine": -218, "favorite": True},
        "awayTeamOdds": {"moneyLine": 180, "favorite": False},
        **line,
    }


@pytest.mark.parametrize("provider", ["DraftKings", "Draft Kings", "  dRaFt KiNgS  "])
def test_draftkings_labels_are_prices_with_source_name_preserved(backfiller, provider):
    market, vendors = backfiller.parse("g1", {"pickcenter": [_entry(provider)]}, "1")

    assert market == {
        "ml_home": -218.0,
        "ml_away": 180.0,
        "spread_home": -5.5,
        "total_points": 220.5,
        "provider": provider.strip(),
        "_key": provider.strip().lower(),
    }
    assert vendors == []
    assert backfiller.unknown_providers == {}


@pytest.mark.parametrize("book_first", [True, False])
def test_spaced_label_beats_consensus_in_either_order(backfiller, book_first):
    book = _entry("Draft Kings")
    consensus = _entry("consensus", overUnder=200.0)
    entries = [book, consensus] if book_first else [consensus, book]

    market, vendors = backfiller.parse("g1", {"pickcenter": entries}, "1")

    assert market["provider"] == "Draft Kings"
    assert market["total_points"] == 220.5
    assert vendors == []


def test_books_keep_first_entry_priority_and_away_favourite_orientation(backfiller):
    first = _entry("DraftKings", overUnder=210.0)
    alias = _entry(
        "Draft Kings",
        homeTeamOdds={"moneyLine": 180, "favorite": False},
        awayTeamOdds={"moneyLine": -218, "favorite": True},
    )
    market, _ = backfiller.parse("g1", {"pickcenter": [first, alias]}, "1")
    assert market["provider"] == "DraftKings"
    assert market["total_points"] == 210.0

    market, _ = backfiller.parse("g1", {"pickcenter": [alias, first]}, "1")
    assert market["provider"] == "Draft Kings"
    assert market["spread_home"] == 5.5
    assert market["ml_home"] == 180.0
    assert market["ml_away"] == -218.0


@pytest.mark.parametrize("provider", ["numberfire", "teamrankings", "espn bpi", "bpi"])
def test_vendor_forecasts_remain_retrospective_snapshots(backfiller, provider):
    market, vendors = backfiller.parse(
        "g1", {"pickcenter": [_entry(provider), _entry("Draft Kings")]}, "1"
    )

    assert market["provider"] == "Draft Kings"
    assert len(vendors) == 1
    row = vendors[0]
    assert row[:2] == ("g1", provider)
    assert row[3:] == (-218.0, 180.0, -5.5, None, None, 220.5, None, None, 0)
    assert backfiller.unknown_providers == {}


@pytest.mark.parametrize("provider", ["Draft  Kings", "Draft-Kings", "Draft Kings Model", "Unclassified"])
def test_other_labels_are_rejected_and_counted_across_games(backfiller, provider):
    for game_id in ("g1", "g2"):
        market, vendors = backfiller.parse(
            game_id, {"pickcenter": [_entry(provider), _entry(provider)]}, "1"
        )
        assert market is None
        assert vendors == []
    assert backfiller.unknown_providers == {provider: 4}


def test_unknown_prices_do_not_displace_a_known_book(backfiller):
    market, vendors = backfiller.parse(
        "g1", {"pickcenter": [_entry("Unclassified", overUnder=300), _entry("Draft Kings")]}, "1"
    )
    assert market["provider"] == "Draft Kings"
    assert market["total_points"] == 220.5
    assert vendors == []
    assert backfiller.unknown_providers == {"Unclassified": 1}


@pytest.mark.parametrize("provider", ["Draft Kings", "Unclassified", ""])
def test_entries_without_any_line_are_skipped(backfiller, provider):
    market, vendors = backfiller.parse(
        "g1", {"pickcenter": [{"provider": {"name": provider}}]}, "1"
    )
    assert market is None
    assert vendors == []
    assert backfiller.unknown_providers == {}


@pytest.mark.asyncio
async def test_backfill_writes_only_known_prices_and_vendor_snapshots(backfiller, monkeypatch):
    warehouse = backfiller.wh
    warehouse.upsert_competition("nba", "NBA")
    home = warehouse.upsert_team("1", "Atlanta Hawks", conference="East")
    away = warehouse.upsert_team("2", "Boston Celtics", conference="East")
    warehouse.upsert_games([
        GameRow(
            game_id=game_id, source="espn", competition_id="nba", season=2027,
            season_type=2, date_utc=f"2026-10-{day}T23:00:00+00:00",
            home_team_id=home, away_team_id=away, home_score=110, away_score=100,
        )
        for game_id, day in [("known", 20), ("unknown", 21)]
    ])

    async def fetch(client, game_id):
        provider = "Draft Kings" if game_id == "known" else "Unclassified"
        return {"pickcenter": [_entry(provider), _entry("numberfire")]}

    monkeypatch.setattr(backfiller, "fetch", fetch)
    assert await backfiller.run([("known", "1"), ("unknown", "1")]) == {
        "fetched": 2, "market": 1, "vendor": 2,
    }
    rows = warehouse.conn.execute(
        "SELECT game_id, ml_home, ml_away, spread_home, total_points, odds_provider "
        "FROM games ORDER BY game_id"
    ).fetchall()
    assert tuple(rows[0]) == ("known", -218.0, 180.0, -5.5, 220.5, "Draft Kings")
    assert tuple(rows[1]) == ("unknown", None, None, None, None, None)
    snapshots = warehouse.conn.execute(
        "SELECT game_id, provider, before_tipoff FROM odds_snapshots ORDER BY game_id"
    ).fetchall()
    assert [tuple(row) for row in snapshots] == [
        ("known", "numberfire", 0), ("unknown", "numberfire", 0),
    ]
    assert backfiller.unknown_providers == {"Unclassified": 1}
