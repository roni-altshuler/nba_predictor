"""FastAPI application.

    PYTHONPATH=. uvicorn backend.main:app --reload --port 8000

The API serves the SAME published artifacts the Next.js frontend reads, and
that is deliberate: there is exactly one place a probability is computed —
the Python pipeline — and everything else reads what it wrote. An endpoint
that recomputed a forecast would be a second model nobody benchmarked.

The frontend does not depend on this process being up. Next.js reads the
artifacts off disk at build time, so the site is fully static and this API
exists for programmatic consumers and for local development.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS = ROOT / "backend" / "data" / "predictions"
DIAGNOSTICS = ROOT / "backend" / "data" / "diagnostics"

app = FastAPI(
    title="Hardwood API",
    description=(
        "Calibrated NBA game and season forecasting. Every probability here "
        "was produced by a published model version and is scored against the "
        "closing line on /v1/accuracy."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _read(path: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _require(path: Path, what: str) -> Dict[str, Any]:
    payload = _read(path)
    if payload is None:
        # 503 rather than 404: the resource exists conceptually, the pipeline
        # has simply not produced it. A consumer should retry, not give up.
        raise HTTPException(
            status_code=503,
            detail=f"{what} has not been published yet — run the pipeline",
        )
    return payload


@app.get("/health")
def health() -> Dict[str, Any]:
    """Liveness plus artifact presence.

    Reports WHICH artifacts are missing rather than a bare "ok". A deploy
    whose pipeline has not run serves an empty site, and a health check that
    cannot tell the difference is not a health check.
    """
    artifacts = {
        "season_projections": (PREDICTIONS / "season_projections.json").exists(),
        "game_forecasts": (PREDICTIONS / "game_forecasts.json").exists(),
        "power_ratings": (PREDICTIONS / "power_ratings.json").exists(),
        "market_benchmark": (DIAGNOSTICS / "market_benchmark.json").exists(),
        "series_model": (DIAGNOSTICS / "series_model.json").exists(),
    }
    missing = [name for name, present in artifacts.items() if not present]
    return {
        "status": "degraded" if missing else "ok",
        "artifacts": artifacts,
        "missing": missing,
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


@app.get("/v1/projections")
def projections() -> Dict[str, Any]:
    """Season projection: records, seeds, playoff and title odds."""
    return _require(PREDICTIONS / "season_projections.json", "the season projection")


@app.get("/v1/ratings")
def ratings() -> Dict[str, Any]:
    """Current power ratings for all 30 franchises."""
    return _require(PREDICTIONS / "power_ratings.json", "power ratings")


@app.get("/v1/games")
def games(
    limit: int = Query(100, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    team: Optional[str] = Query(None, description="filter by abbreviation"),
    flagged_only: bool = Query(False, description="only games with a value flag"),
) -> Dict[str, Any]:
    """Upcoming game forecasts, with the value surface where priced."""
    payload = _require(PREDICTIONS / "game_forecasts.json", "game forecasts")
    rows: List[Dict[str, Any]] = payload.get("games", [])

    if team:
        wanted = team.upper()
        rows = [
            g
            for g in rows
            if g["home"]["abbreviation"] == wanted or g["away"]["abbreviation"] == wanted
        ]
    if flagged_only:
        rows = [g for g in rows if (g.get("value") or {}).get("flagged")]

    window = rows[offset : offset + limit]
    return {
        "season": payload.get("season"),
        "generated_at": payload.get("generated_at"),
        "model_version": payload.get("model_version"),
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "games": window,
    }


@app.get("/v1/games/{game_id}")
def game(game_id: str) -> Dict[str, Any]:
    payload = _require(PREDICTIONS / "game_forecasts.json", "game forecasts")
    for row in payload.get("games", []):
        if str(row.get("game_id")) == str(game_id):
            return row
    raise HTTPException(status_code=404, detail=f"no forecast for game {game_id}")


@app.get("/v1/accuracy")
def accuracy() -> Dict[str, Any]:
    """The record: per-game against the market, and per-series.

    The two stay under SEPARATE keys. A per-game Brier and a per-series
    Brier describe different outcome spaces, and averaging them would
    produce a number that describes neither.
    """
    market = _require(DIAGNOSTICS / "market_benchmark.json", "the market benchmark")
    return {"market": market, "series": _read(DIAGNOSTICS / "series_model.json")}


@app.get("/v1/elo-sweep")
def elo_sweep() -> Dict[str, Any]:
    """The Elo hyper-parameter sweep, including home advantage by era."""
    return _require(DIAGNOSTICS / "elo_sweep.json", "the Elo sweep")
