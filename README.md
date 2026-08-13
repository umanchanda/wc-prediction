# Premier League 2026-27 Live Prediction API

A small FastAPI backend that polls a football data provider, runs an
in-play-aware prediction model, and serves live win/draw/loss probabilities.

## Why a backend (not just the web app)
- Your API key stays on the server, never in the browser.
- One poller hits the provider on an interval; all visitors read the cache.
- The model is in-play aware: as a match progresses, the current score
  takes over from the pre-match strength prior.

## Quick start (no API key needed)
```bash
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```
Open http://localhost:8000/live — runs in **mock mode**, simulating one
match (example teams) ticking forward so you can watch probabilities move.

## Going live with real data
1. Sign up for a provider (Sportmonks or API-Football provide live xG;
   choose a feed appropriate for club fixtures or live match data).
2. `cp .env.example .env`, set `PROVIDER` and your key.
3. Restart the server.
4. If the provider's JSON shape differs, adjust the `_map` methods in
   `datasource.py` — that's the only place field names live.

## Endpoints
- `GET /live` — all live matches with fresh predictions
- `GET /predict?home=France&away=Haiti` — pre-match prediction for any pair
- `GET /` — health + active provider

## Files
- `model.py` — the prediction math (pre-match + in-play blend)
- `datasource.py` — provider adapters (mock / Sportmonks / API-Football)
- `server.py` — FastAPI app + background poller

## Connecting your existing web app
Point the frontend's fetch at `http://localhost:8000/live` instead of
calling any provider directly. CORS is open for GET so it works in-browser.
