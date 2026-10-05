"""Provider failures must not become empty, successful warehouse refreshes."""

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
import yaml

from backend.scripts import build_warehouse
from backend.services.data.espn_loader import ESPNLoader
from backend.services.data.ingestion import read_status, record_status
from backend.services.data.warehouse import Warehouse
from backend.services.espn.client import ESPNClient, ESPNUnavailable
from backend.tests.test_warehouse_and_loader import _event


START = datetime(2026, 10, 3, tzinfo=timezone.utc)
END = datetime(2026, 10, 5, tzinfo=timezone.utc)
RANGE_ERROR = {"code": 400, "message": "Failed to get events endpoint."}


@pytest.fixture
def mock_client(monkeypatch):
    def create(handler):
        client = ESPNClient()
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        monkeypatch.setattr(client, "_get_client", AsyncMock(return_value=http))
        return client

    # Mock transports have no sockets to close; each test owns its client.
    return create


@pytest.fixture(autouse=True)
def no_retry_delay(monkeypatch):
    monkeypatch.setattr("backend.services.espn.client.asyncio.sleep", AsyncMock())


@pytest.mark.asyncio
async def test_known_range_failure_falls_back_once_and_keeps_empty_days(mock_client):
    dates = []

    def respond(request):
        token = request.url.params["dates"]
        dates.append(token)
        assert request.url.params["limit"] == "1000"
        if "-" in token:
            return httpx.Response(400, json=RANGE_ERROR)
        # A UTC timestamp on the next day is still filed on the Eastern day.
        events = [] if token == "20261004" else [_event("12", date="2026-10-04T02:30Z")]
        return httpx.Response(200, json={"events": events})

    events = await mock_client(respond).get_scoreboard_range(START, END, chunk_days=2)
    assert dates == ["20261003-20261004", "20261003", "20261004", "20261005"]
    assert [e["id"] for e in events] == ["12"]


@pytest.mark.asyncio
async def test_successful_ranges_cover_inclusive_endpoint_and_deduplicate(mock_client):
    dates = []

    def respond(request):
        dates.append(request.url.params["dates"])
        return httpx.Response(200, json={"events": [_event("12")]})

    assert len(await mock_client(respond).get_scoreboard_range(START, END, chunk_days=2)) == 1
    assert dates == ["20261003-20261004", "20261005"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status,error,calls", [
    (400, {"message": "bad limit"}, 1), (401, RANGE_ERROR, 1),
    (403, RANGE_ERROR, 1), (404, RANGE_ERROR, 1),
    (429, RANGE_ERROR, 3), (500, RANGE_ERROR, 3),
])
async def test_other_http_failures_never_trigger_daily_fanout(mock_client, status, error, calls):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(status, json=error)

    with pytest.raises(ESPNUnavailable):
        await mock_client(respond).get_scoreboard_range(START, END)
    assert len(requests) == calls
    assert all("-" in r.url.params["dates"] for r in requests)


@pytest.mark.asyncio
async def test_one_failed_day_refuses_partial_events(mock_client):
    dates = []

    def respond(request):
        token = request.url.params["dates"]
        dates.append(token)
        if "-" in token or token == "20261004":
            return httpx.Response(400, json=RANGE_ERROR)
        return httpx.Response(200, json={"events": [_event("12")]})

    with pytest.raises(ESPNUnavailable):
        await mock_client(respond).get_scoreboard_range(START, END)
    assert dates == ["20261003-20261005", "20261003", "20261004"]


@pytest.mark.asyncio
async def test_transport_failure_is_bounded(mock_client):
    requests = []

    def respond(request):
        requests.append(request)
        raise httpx.ConnectError("offline", request=request)

    with pytest.raises(ESPNUnavailable):
        await mock_client(respond).get_scoreboard_range(START, END)
    assert len(requests) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [None, [], {}, {"events": None}, {"events": {}},
    {"events": [None]}, {"events": [{"id": "12"}]},
    *[{"events": [_event(event_id=i)]} for i in [None, "", "None", 0, True, -1, "bad"]],
    {"events": [_event(date="bad")]}, {"events": [_event(state="unknown")]},
    {"events": [], "code": 503},
    {"events": [_event(home=("None", "Atlanta Hawks", 110))]},
    {"events": [_event(home=("1", "Atlanta Hawks", None))]},
])
async def test_invalid_payload_is_unavailable_and_never_cached(mock_client, payload):
    client = mock_client(lambda request: httpx.Response(200, json=payload))
    with pytest.raises(ESPNUnavailable):
        await client.get_scoreboard_range(START, END, use_cache=True)
    assert client.cache._cache == {}


@pytest.mark.asyncio
async def test_non_json_success_is_unavailable(mock_client):
    client = mock_client(lambda request: httpx.Response(200, text="<html>outage</html>"))
    with pytest.raises(ESPNUnavailable, match="invalid JSON"):
        await client.get_scoreboard_range(START, END)


@pytest.mark.asyncio
async def test_healthy_empty_range_is_not_an_outage(mock_client):
    client = mock_client(lambda request: httpx.Response(200, json={"events": []}))
    assert await client.get_scoreboard_range(START, END) == []


@pytest.mark.asyncio
async def test_limit_is_a_failure_not_a_warning(mock_client):
    client = mock_client(lambda request: httpx.Response(200, json={"events": [_event("12")]}))
    with pytest.raises(ESPNUnavailable, match="truncated"):
        await client.get_scoreboard_range(START, END, limit=1, use_cache=True)
    assert client.cache._cache == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [{"chunk_days": 0}, {"chunk_days": -1}, {"limit": 0}])
async def test_invalid_bounds_fail_before_http(mock_client, kwargs):
    client = mock_client(lambda request: pytest.fail("unexpected HTTP request"))
    with pytest.raises(ValueError):
        await client.get_scoreboard_range(START, END, **kwargs)


@pytest.fixture
def existing_warehouse(tmp_path):
    wh = Warehouse(tmp_path / "warehouse.sqlite")
    wh.migrate()
    loader = ESPNLoader(wh)
    loader.load_events([_event("10")])
    wh.record_predictions([{
        "fixture_uid": "nba:preserved", "generated_at": "2026-01-01T00:00:00Z",
        "model_version": "original", "competition_id": "nba", "season": 2026,
        "p_home": .6, "p_away": .4,
    }])
    yield wh
    wh.close()


def configure_run(monkeypatch, wh, events):
    client = AsyncMock(spec=ESPNClient)
    client.get_teams.return_value = [{"id": "1", "displayName": "Changed name"}]
    client.get_standings.return_value = None
    client.get_scoreboard_range.side_effect = events
    monkeypatch.setattr(build_warehouse, "get_warehouse", lambda *args: wh)
    monkeypatch.setattr(build_warehouse, "get_espn_client", lambda: client)
    return client


@pytest.mark.asyncio
async def test_later_season_failure_preserves_all_rows_and_last_success(
    tmp_path, monkeypatch, existing_warehouse,
):
    wh = existing_warehouse
    before = "\n".join(wh.conn.iterdump())
    status = tmp_path / "status.json"
    old = record_status(status, seasons=[2026, 2027], status="ok", event_count=3)
    client = configure_run(monkeypatch, wh, [[_event("11")], ESPNUnavailable("offline")])
    assert await build_warehouse.run(["--seasons", "2026-2027", "--status-file", str(status)]) == 1
    assert "\n".join(wh.conn.iterdump()) == before
    observed = read_status(status)
    assert observed["status"] == "unavailable"
    assert observed["last_success_at"] == old["last_success_at"]
    assert observed["event_count"] is None
    assert observed["warehouse_updated"] is False
    client.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_loader_failure_rolls_back_nested_writes(tmp_path, monkeypatch, existing_warehouse):
    wh = existing_warehouse
    before = "\n".join(wh.conn.iterdump())
    configure_run(monkeypatch, wh, [[_event("11")]])
    original = ESPNLoader.load_events

    def fail_after_write(self, events):
        original(self, events)
        raise RuntimeError("write failed")

    monkeypatch.setattr(ESPNLoader, "load_events", fail_after_write)
    assert await build_warehouse.run([
        "--seasons", "2026", "--status-file", str(tmp_path / "status.json"),
    ]) == 1
    assert "\n".join(wh.conn.iterdump()) == before


@pytest.mark.asyncio
async def test_successful_empty_run_reports_zero_events(tmp_path, monkeypatch, existing_warehouse):
    wh = existing_warehouse
    configure_run(monkeypatch, wh, [[]])
    status = tmp_path / "status.json"
    assert await build_warehouse.run(["--seasons", "2026", "--status-file", str(status)]) == 0
    assert read_status(status)["event_count"] == 0
    assert read_status(status)["status"] == "ok"
    assert wh.conn.execute("SELECT COUNT(*) FROM prediction_snapshots").fetchone()[0] == 1


def test_current_season_refresh_blocks_publication_on_failure():
    workflow = Path(__file__).resolve().parents[2] / ".github/workflows/daily_forecast.yml"
    steps = yaml.safe_load(workflow.read_text())["jobs"]["forecast"]["steps"]
    refresh = next(s for s in steps if s.get("name") == "Refresh the current season")
    assert not refresh.get("continue-on-error", False)
    for name in ["Publish the forecast", "Commit refreshed artifacts", "Republish the warehouse"]:
        step = next(s for s in steps if s.get("name") == name)
        assert step.get("if", "success()") == "success()"
    diagnostics = next(s for s in steps if s.get("name") == "Retain ingestion diagnostics")
    assert diagnostics["if"] == "always()"
