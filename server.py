"""
server.py — FastAPI backend.

  GET /            -> health + which provider is active
  GET /live        -> every live match with a fresh prediction
  GET /predict?home=France&away=Haiti  -> pre-match prediction for any pairing

A background thread polls the data source on an interval and caches the
result, so incoming web requests are instant and you never hammer (or leak)
your API key from the browser. The frontend should poll THIS server, never
the provider directly.

Run:
  pip install -r requirements.txt
  uvicorn server:app --reload --port 8000
Then open http://localhost:8000/live
"""

from __future__ import annotations
import os
import threading
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()  # must run before any os.getenv() calls below

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from model import GameState, predict, prematch_expected_goals
from datasource import get_source

POLL_SECONDS = int(os.getenv("POLL_SECONDS", "20"))

_cache: dict = {"updated": 0, "matches": []}
_lock = threading.Lock()
_source = get_source()
_stop = threading.Event()


def _poll_loop() -> None:
    while not _stop.is_set():
        try:
            states = _source.fetch_live()
            preds = [predict(gs).__dict__ for gs in states]
            with _lock:
                _cache["matches"] = preds
                _cache["updated"] = time.time()
        except Exception as e:  # noqa: BLE001 - keep the loop alive
            print(f"[poll] error: {e}")
        _stop.wait(POLL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    t = threading.Thread(target=_poll_loop, daemon=True)
    t.start()
    yield
    _stop.set()


app = FastAPI(title="WC2026 Prediction API", lifespan=lifespan)

# allow your frontend (any origin) to read this API in the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"],
)


@app.get("/healthz")
def health():
    return {
        "service": "WC2026 Prediction API",
        "provider": os.getenv("PROVIDER", "mock"),
        "poll_seconds": POLL_SECONDS,
        "last_update": _cache["updated"],
    }


@app.get("/live")
def live():
    with _lock:
        return {"updated": _cache["updated"], "matches": _cache["matches"]}


@app.get("/predict")
def predict_pair(
    home: str = Query(..., description="home team name"),
    away: str = Query(..., description="away team name"),
):
    """Pre-match prediction for any pairing (e.g. knockout what-ifs)."""
    gs = GameState(home=home, away=away, status="NS")
    lam_h, lam_a = prematch_expected_goals(home, away)
    p = predict(gs)
    return {**p.__dict__, "prematch_xg": {"home": round(lam_h, 2), "away": round(lam_a, 2)}}


# Serve the production frontend build.  Only mounts when frontend/dist exists
# (i.e. on Heroku after the Node buildpack runs).  All API routes above take
# priority; this is purely a catch-all for static assets and HTML.
if os.path.isdir("frontend/dist"):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
