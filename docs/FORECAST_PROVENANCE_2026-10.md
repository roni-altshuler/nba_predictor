# Warehouse forecast provenance

The October 9 change starts from main
`06bd1b5b280e0310880321f04216d1cdc80480a2`. The warehouse writer used
`INSERT OR REPLACE`: a second payload under the same fixture/timestamp/model
key could replace an earlier claim. Its earliest-forecast query used lexical
timestamp ordering and joined back without a model-version key. Timezone
offsets could invert chronology, and simultaneous versions could return more
than one row, including versions that failed the eligibility filter.

These are reproduced code paths, not evidence that published results were
corrupted. Preseason live `n = 0` remains correct. The committed first-forecast
log is a separate safeguard and is unchanged.

## Write rules

- The existing `(fixture_uid, generated_at, model_version)` key is unchanged.
  Different keys remain distinct snapshots, including different timestamp
  spellings of the same instant. No timestamps or historical rows are rewritten.
- Insert on key conflict does nothing. An identical payload is then verified
  using every stored column, NULL-safe comparisons and SQLite column affinity.
  Existing numeric coercion remains in force; a retry of season `"2027"` matches
  stored integer `2027`.
- A different stored payload raises `ValueError`. The existing transaction or
  nested savepoint rolls back every write in that batch, whether the conflict
  is with history or with an earlier row in the same batch. An identical retry
  preserves the row's identity. The return value still counts submitted rows,
  including identical retries, as the publisher expects.
- The insert obtains the writer lock before inspecting a duplicate; the
  conflict policy does not rely on an unlocked read followed by an insert.
  Only the named primary-key conflict is ignored; other SQL failures propagate.

## Selection rules

Season filtering applies before selection. The shared strict `utc` parser
interprets publication and tipoff as actual instants, including their offsets
and microsecond precision. Unknown, malformed, impossible or timezone-free
dates are unprovable and excluded; equality with tipoff is excluded too.

`p_home` must be finite and within `[0, 1]`. Missing `p_away` remains missing;
when supplied, it must also be finite, in range, and complement `p_home` within
an absolute tolerance of `1e-6` for decimal rounding. Invalid stored rows are
excluded before selecting a winner, but remain in the database.

For each fixture, choose the minimum tuple of `(UTC publication instant,
model_version, original publication timestamp)`. The latter two fields use
lexical ordering solely to resolve simultaneous claims deterministically,
independently of insertion order; this does not rank model quality. Return the
original `sqlite3.Row` and column set, then order winners by actual tipoff and
fixture id. The cursor streams history while retaining one winner per fixture.

No schema migration, forecast regeneration, retraining, artifact rewrite,
first-log edit, workflow edit or UI change is part of this work. NFL was read
only as a reference; its SQL date ordering was not copied because SQLite's
date functions can collapse distinct sub-millisecond instants.

## Regression checks

Tests use temporary databases. They cover all stored payload fields,
idempotent retries, distinct keys, conflicts against existing and within-batch
rows, full rollback and nested transaction isolation. Reader cases cover
positive/negative offsets, equal instants across model versions and timestamp
spellings, strict microsecond boundaries, invalid dates/probabilities, valid
probability endpoints, optional missing away probability, season isolation,
and unchanged returned columns. The existing retry test now checks row identity
as well as row count.

The corrected initial regression set ran against a clean archive of the base:
42 failures / 12 passes across 54 cases before the implementation. The initial
test helper mistakenly assumed NFL's `count` method; that test-helper error was
corrected before this baseline comparison, and its earlier failed run is not
used as evidence. Raw before/after reports remain in the saved cloud environment.

Final local validation passed all 409 backend cases and all 270 frontend tests
in 34 suites. The 14 existing live-card/frontend cases also passed separately.
These are regression results, not a new model-accuracy measurement.

```sh
python -m pytest backend/tests/test_prediction_snapshots.py backend/tests/test_live_record.py \
  backend/tests/test_forecast_safety.py backend/tests/test_espn_ingestion.py \
  backend/tests/test_warehouse_restore_workflow.py -q
python -m pytest backend/tests/ -q
npm test -- --runInBand src/__tests__/components/live.test.tsx
```

The full backend suite includes first-log preservation/corruption/rebuild tests,
warehouse restore fail-closed checks, ingestion rollback and empty-record
`n = 0`/`insufficient` checks. The snapshot column contract and frontend
artifact/API shape are unchanged. Frontend live-card regression tests also
check that forecasts remain visible beside live scores. This backend-only
change needs no new visual surface or repeated public-feed browser request.
