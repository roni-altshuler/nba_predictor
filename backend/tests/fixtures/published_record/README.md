These are fixed test inputs, independent of the changing files in `backend/data`.

`preseason.json` and `forecast_log.json` are exact copies from the held October 17
branch. The same 1,200 first calls are also present on the pinned October 26 main.
The preseason fixture intentionally has no scored games or coverage metadata.

`active-season.json` preserves the 43 published result rows and all their existing
values from main `8e8d69240213022773254b9d4c9ee8f6279536cb`. Only `date_utc` was added
from each matching game's recorded event date in that commit's history export.
IDs, participants, final scores and saved forecast provenance were checked first.
The history export's backtest probabilities and model estimates were not used.
This is a consumer compatibility fixture, not regenerated production data or a
full-warehouse coverage assertion. Event dates are recorded metadata, not an
independent observation of physical tipoff. See `provenance.json` for source hashes.

`producer-contract.json` is a deliberately synthetic, small unit-test contract.
The backend test invokes the real scoring CLI against its isolated pytest
warehouse and compares the serialized report with this fixture. The frontend
consumes that same report. It includes a win, a loss, a completed game with no
eligible call, and one pending call. It is never a production warehouse substitute.

`timestamp-precision.json` contains synthetic timestamp boundary cases shared by
the producer and consumer tests. UTC instants retain the producer's microsecond
precision for pregame eligibility, publication cutoffs, and ordering.

Before activating the held UI, the producer change must be reviewed and the live
artifact regenerated from the authoritative warehouse. Missing result dates must
not be replaced with saved schedule dates to force acceptance. Publishing the
producer and compatible artifact first permits the existing UI to keep running.
