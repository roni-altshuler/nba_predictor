"""Immutable warehouse claims and one valid chronological forecast per fixture."""

import pytest

from backend.services.data.warehouse import Warehouse


@pytest.fixture
def warehouse(tmp_path):
    house = Warehouse(tmp_path / "snapshots.sqlite")
    house.migrate()
    yield house
    house.close()


def snapshot(**changes):
    return dict({
        "fixture_uid": "g1", "generated_at": "2026-10-09T08:00:00Z",
        "model_version": "model-a", "competition_id": "nba", "season": 2027,
        "tipoff_utc": "2026-10-20T19:00:00Z", "home_team": "BOS", "away_team": "DET",
        "p_home": .6, "p_away": .4, "exp_margin": 3.5, "exp_total": 220.,
    }, **changes)


def stored(warehouse):
    return [tuple(row) for row in warehouse.conn.execute(
        "SELECT rowid, * FROM prediction_snapshots ORDER BY rowid"
    )]


@pytest.mark.parametrize("change", [
    {"competition_id": "other"}, {"season": 2026},
    {"tipoff_utc": "2026-10-20T20:00:00Z"}, {"home_team": "NY"}, {"away_team": None},
    {"p_home": .7}, {"p_away": .3}, {"exp_margin": None}, {"exp_total": 221.},
])
def test_every_stored_payload_field_is_immutable(warehouse, change):
    warehouse.record_predictions([snapshot()])
    before = stored(warehouse)
    with pytest.raises(ValueError, match="immutable"):
        warehouse.record_predictions([snapshot(**change)])
    assert stored(warehouse) == before


def test_identical_retries_respect_sqlite_affinity_and_nulls(warehouse):
    row = snapshot(season="2027", p_home="0.6", exp_margin=None)
    assert warehouse.record_predictions([row]) == 1
    before = stored(warehouse)
    assert warehouse.record_predictions(iter([row, row])) == 2
    assert stored(warehouse) == before


def test_distinct_keys_and_identical_batch_retries_preserve_snapshots(warehouse):
    rows = [snapshot(), snapshot(model_version="model-b"),
            snapshot(generated_at="2026-10-09T09:00:00Z"), snapshot(fixture_uid="g2")]
    assert warehouse.record_predictions([*rows, rows[0]]) == 5
    assert len(stored(warehouse)) == 4
    assert warehouse.record_predictions([]) == 0


@pytest.mark.parametrize("conflict_first", [False, True])
def test_conflict_with_history_rolls_back_the_entire_batch(warehouse, conflict_first):
    warehouse.record_predictions([snapshot()])
    before = stored(warehouse)
    batch = [snapshot(fixture_uid="new"), snapshot(p_home=.7)]
    if conflict_first:
        batch.reverse()
    with pytest.raises(ValueError, match="immutable"):
        warehouse.record_predictions(batch)
    assert stored(warehouse) == before


def test_conflicting_duplicates_roll_back_new_rows_in_the_same_batch(warehouse):
    with pytest.raises(ValueError, match="immutable"):
        warehouse.record_predictions([snapshot(fixture_uid="other"),
                                      snapshot(), snapshot(exp_total=221.)])
    assert len(stored(warehouse)) == 0


def test_failed_batch_does_not_discard_an_unrelated_outer_transaction(warehouse):
    warehouse.record_predictions([snapshot()])
    with warehouse.transaction():
        warehouse.record_predictions([snapshot(fixture_uid="outer")])
        before = stored(warehouse)
        with pytest.raises(ValueError, match="immutable"):
            warehouse.record_predictions([snapshot(fixture_uid="rolled-back"), snapshot(p_home=.7)])
        assert stored(warehouse) == before
    assert {r["fixture_uid"] for r in warehouse.earliest_predictions()} == {"g1", "outer"}


def test_earliest_uses_utc_instants_instead_of_timestamp_spelling(warehouse):
    warehouse.record_predictions([
        snapshot(generated_at="2026-10-09T10:00:00Z"),
        snapshot(generated_at="2026-10-09T11:00:00+03:00", p_home=.65, p_away=.35),
        snapshot(generated_at="2026-10-09T09:00:00-04:00"),
    ])
    row, = warehouse.earliest_predictions()
    assert row["generated_at"] == "2026-10-09T11:00:00+03:00"
    assert row["p_home"] == .65


@pytest.mark.parametrize("reverse", [False, True])
def test_equal_instant_versions_and_spellings_have_one_deterministic_winner(warehouse, reverse):
    rows = [snapshot(generated_at="2026-10-09T11:00:00+03:00", model_version="model-b"),
            snapshot(generated_at="2026-10-09T08:00:00Z"),
            snapshot(generated_at="2026-10-09T08:00:00+00:00", p_home=.65, p_away=.35)]
    warehouse.record_predictions(list(reversed(rows)) if reverse else rows)
    row, = warehouse.earliest_predictions()
    assert row["model_version"] == "model-a"
    assert row["generated_at"] == "2026-10-09T08:00:00+00:00"
    assert row["p_home"] == .65
    assert len(stored(warehouse)) == 3


def test_selection_and_strict_boundary_keep_microsecond_precision(warehouse):
    warehouse.record_predictions([
        snapshot(generated_at="2026-10-09T08:00:00.000002Z", model_version="model-a",
                 tipoff_utc="2026-10-09T08:00:00.000003Z"),
        snapshot(generated_at="2026-10-09T08:00:00.000001Z", model_version="model-b",
                 tipoff_utc="2026-10-09T08:00:00.000002Z"),
    ])
    row, = warehouse.earliest_predictions()
    assert row["model_version"] == "model-b"


@pytest.mark.parametrize("generated,tipoff,eligible", [
    ("2026-10-20T21:00:00+03:00", "2026-10-20T19:00:00Z", True),
    ("2026-10-20T17:00:00-04:00", "2026-10-20T20:00:00Z", False),
    ("2026-10-20T17:00:00Z", "2026-10-20T20:00:00+03:00", False),
])
def test_strict_pre_tipoff_uses_actual_instants(warehouse, generated, tipoff, eligible):
    warehouse.record_predictions([snapshot(generated_at=generated, tipoff_utc=tipoff)])
    assert bool(warehouse.earliest_predictions()) is eligible


@pytest.mark.parametrize("field", ["generated_at", "tipoff_utc"])
@pytest.mark.parametrize("invalid", [
    None, "", "bad-date", "2026-02-30T12:00:00Z", "2026-10-09",
    "2026-10-09T12:00:00", "0001-01-01T00:00:00+01:00",
])
def test_unprovable_dates_are_excluded_without_deleting_history(warehouse, field, invalid):
    warehouse.record_predictions([snapshot(**{field: invalid})])
    assert warehouse.earliest_predictions() == []
    assert len(stored(warehouse)) == 1


@pytest.mark.parametrize("field,invalid", [
    ("p_home", None), ("p_home", "bad"), ("p_home", "NaN"),
    ("p_home", float("nan")), ("p_home", float("inf")), ("p_home", float("-inf")),
    ("p_home", -.01), ("p_home", 1.01),
    ("p_away", "bad"), ("p_away", "NaN"), ("p_away", float("inf")),
    ("p_away", -.01), ("p_away", 1.01), ("p_away", .6),
])
def test_invalid_legacy_probability_is_not_selected_over_a_valid_forecast(warehouse, field, invalid):
    # Seed malformed legacy data directly into this temporary database. Read
    # validation must handle restored history as well as the current writer.
    legacy = snapshot(**{field: invalid})
    with warehouse.transaction() as conn:
        conn.execute(
            "INSERT INTO prediction_snapshots (fixture_uid, generated_at, model_version, "
            "competition_id, season, tipoff_utc, home_team, away_team, p_home, p_away, "
            "exp_margin, exp_total) VALUES (:fixture_uid, :generated_at, :model_version, "
            ":competition_id, :season, :tipoff_utc, :home_team, :away_team, :p_home, :p_away, "
            ":exp_margin, :exp_total)", legacy,
        )
    warehouse.record_predictions([snapshot(generated_at="2026-10-09T09:00:00Z")])
    row, = warehouse.earliest_predictions()
    assert row["generated_at"] == "2026-10-09T09:00:00Z"
    assert len(stored(warehouse)) == 2


def test_missing_optional_away_probability_stays_missing(warehouse):
    warehouse.record_predictions([snapshot(p_away=None)])
    row, = warehouse.earliest_predictions()
    assert row["p_home"] == .6 and row["p_away"] is None


@pytest.mark.parametrize("p_home,p_away", [(0., 1.), (1., 0.), (.6, .4000005)])
def test_valid_probability_boundaries_and_rounding_are_retained(warehouse, p_home, p_away):
    warehouse.record_predictions([snapshot(p_home=p_home, p_away=p_away)])
    row, = warehouse.earliest_predictions()
    assert (row["p_home"], row["p_away"]) == (p_home, p_away)


def test_ineligible_simultaneous_versions_cannot_leak_through_a_join(warehouse):
    warehouse.record_predictions([
        snapshot(model_version="a-late", tipoff_utc="2026-10-09T07:00:00Z"),
        snapshot(model_version="b-valid"),
        snapshot(model_version="c-wrong-season", season=2026),
        snapshot(model_version="d-no-probability", p_home=None),
    ])
    row, = warehouse.earliest_predictions(season=2027)
    assert row["model_version"] == "b-valid"
    assert len(stored(warehouse)) == 4


def test_rows_keep_the_existing_shape_and_sort_by_actual_tipoff(warehouse):
    warehouse.record_predictions([
        snapshot(fixture_uid="later", tipoff_utc="2026-10-20T17:00:00Z"),
        snapshot(fixture_uid="z", tipoff_utc="2026-10-20T19:00:00+03:00"),
        snapshot(fixture_uid="a", tipoff_utc="2026-10-20T16:00:00Z"),
    ])
    original_columns = warehouse.conn.execute("SELECT * FROM prediction_snapshots").fetchone().keys()
    rows = warehouse.earliest_predictions()
    assert [row["fixture_uid"] for row in rows] == ["a", "z", "later"]
    assert all(row.keys() == original_columns for row in rows)
