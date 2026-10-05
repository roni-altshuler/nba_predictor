# Ingestion failure and freshness

This change starts from main `77405bbee8a5c90e9c53fc325b132118527a03ab`
(security PR #3). Draft UI PR #2 at
`859a85b4f46908b711f766fd100721dd6e9007da` is unchanged. Its client payload
validation issue is a separate gap.

## Observed provider contract

Read-only GETs on October 5, 2026 used the configured ESPN host and explicit
`limit=1000`. No credentials, source data, release assets or forecasts changed.

| ESPN dates token | HTTP | Events |
| --- | --- | --- |
| `20260901-20260914` | 400 | unavailable |
| `20260901` | 200 | 0 |
| `20261003-20261004` | 400 | unavailable |
| `20261003` | 200 | 1 |
| `20261020` | 200 | 3 |
| `20260115-20260116` | 400 | unavailable |
| `20260115` | 200 | 9 |

Each range error was JSON `{"code":400,"message":"Failed to get events endpoint."}`.
The [range request](https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261003-20261004&limit=1000)
and [single-date request](https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261003&limit=1000)
are reproducible provider reads; ESPN can change their answers.

Only that specific 400 on a multi-day query permits daily fallback. Subsequent
chunks in that call use daily queries without repeated range probes. Other
4xx responses stop immediately except 429; transient transport errors, 429 and
5xx responses have at most three attempts. A failed day never returns a
partial list. Dates remain ESPN Eastern calendar dates: UTC tip-offs on the
next day are retained. Duplicate event IDs are merged without conflating
back-to-back games on consecutive Eastern days.

Scoreboards require an explicit events array, valid event/team IDs and loader
fields (date, season, competitors, status and final scores). Invalid JSON,
provider errors, missing arrays and responses at the event limit are failures.
An explicit valid empty events array remains a healthy empty observation.
Only validated responses enter the client cache.

## Preservation and reporting

`build_warehouse` fetches all selected seasons before constructing a loader.
All warehouse writes then share an outer transaction; nested loader methods
use savepoints. A later fetch or loader failure preserves existing results,
scheduled rows, team metadata and prediction snapshots, and returns exit 1.

Daily ingestion no longer uses `continue-on-error`. Failure prevents forecast
publication, live-record stamping, artifact commits and replacement of the
warehouse release asset. Existing restore protections are unchanged.

`diagnostics/ingestion_status.json` records the attempted refresh independently
of `generated_at`, including scope, status, event count and last success for
the same season scope. Failure event counts are null, not zero. Successful
forecast artifacts embed this ingestion observation. The workflow retains
the diagnostic file even on failure through
[the official upload-artifact action](https://github.com/actions/upload-artifact).

The health endpoint reports ingestion separately. Missing/invalid evidence or
another season is `unknown`; more than 36 hours since the last successful
current-season ingestion is `stale`. Both degrade health even if forecast
artifacts exist. A failed run does not redeploy its diagnostic: its immediate
failure is visible in Actions and the uploaded diagnostic, while the last
deployed ingestion timestamp ages normally.

## Validation and limits

A live smoke test used a temporary warehouse for October 3–4 only. It observed
one rejected range and two successful daily responses, ingested 3 real games,
registered 30 franchises, and passed all 12 warehouse integrity checks.
Synthetic regression fixtures are confined to tests.

Daily fallback requires roughly 335 requests per ordinary season rather than
24 range requests, still under the existing rate limiter. A full historical
rebuild may therefore exceed the existing 60-minute workflow timeout; this
change does not run or optimize that rebuild. No full production refresh,
historical rebuild, model training, forecast regeneration or deployment was
performed. Freshness here measures scoreboard ingestion, not injury, odds,
model accuracy or every optional ESPN endpoint. A health endpoint can remain
degraded independently because of the existing client artifact validator.
