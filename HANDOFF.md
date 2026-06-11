# World Cup 2026 Prediction Project — Handoff

Context doc for picking this project up in Claude Code (or any fresh session).
Read this first, then skim `model.py` and `wc2026.jsx`.

## What this is

A live-updating prediction tool for the 2026 World Cup. Two parts:

1. **Backend** (`wc-prediction-api/`) — a FastAPI server that polls a football
   data provider, runs an in-play-aware prediction model, and serves JSON.
2. **Frontend** (`wc2026.jsx`) — a React app showing every group-stage match
   with win/draw/loss probabilities, expected goals, likeliest scorelines, and
   anytime-scorer odds. It polls the backend's `/live` endpoint and overlays
   live in-play predictions on matches in progress, falling back to a built-in
   static model otherwise.

The frontend was originally authored as a self-contained artifact, so it embeds
its own copy of the static model (team strengths + Poisson) and works with zero
backend. The backend exists to make predictions *live* during matches.

## Architecture / data flow

```
provider API ──poll──> backend (FastAPI)  ──/live JSON──> frontend (React)
 (Sportmonks/           - caches result                    - polls every 15s
  API-Football)         - runs model on each live match    - overlays LIVE cards
                        - key stays server-side            - static model otherwise
```

The browser never talks to the provider directly — that keeps the API key off
the client and avoids rate-limit blowups from visitor traffic.

## Files

### Backend (`wc-prediction-api/`)
- `model.py` — the prediction math. Two regimes that blend over the match:
  - **pre-match**: expected goals from FIFA-points-based team strength.
  - **in-play**: current score is fixed; only the *remaining* minutes are
    modeled (Poisson), adjusted for red cards and live xG if the provider
    supplies it. As time elapses the score dominates and the prediction
    converges on the real result. Entry points: `predict(GameState)` and
    `prematch_expected_goals(home, away)`.
- `datasource.py` — pluggable provider layer. Everything speaks `GameState`.
  Adapters: `MockProvider` (no key, simulates a match ticking), `SportmonksProvider`,
  `ApiFootballProvider`. Switch via the `PROVIDER` env var. The `_map_*` methods
  are the only place provider JSON field names live — adjust there if a feed's
  shape differs from what's assumed.
- `server.py` — FastAPI app. Background thread polls the source every
  `POLL_SECONDS` and caches; web requests read the cache. Endpoints:
  - `GET /` — health + active provider
  - `GET /live` — all live matches with fresh predictions
  - `GET /predict?home=France&away=Haiti` — pre-match prediction for any pairing
- `requirements.txt`, `.env.example`, `README.md` — setup.

### Frontend
- `wc2026.jsx` — single-file React app. Key pieces:
  - `TEAMS`, `GROUPS` — all 48 teams, 12 groups, FIFA-points strengths, key
    attackers per team.
  - `predict(a, b)` — the embedded static Poisson model (mirrors the backend's
    pre-match logic).
  - `useLiveData(url)` — polls `<url>/live` every 15s, returns matchup→prediction.
  - `mergeLive(...)` — overlays a backend prediction onto a card, handling
    home/away orientation and name normalization.
  - Connection bar in the UI: paste backend URL, Connect, status dot shows
    STATIC / LIVE / UNREACHABLE. Live matches get a red LIVE badge + minute.

## Current status — DONE
- Static model: all 72 group-stage matches, win/draw/loss, xG, scorelines,
  scorer odds, group-points projections. Validated for sane outputs.
- Live backend: in-play model tested (lead at 70' ~92%, trailing at 88' collapses,
  red card swings a coin-flip). All endpoints tested end-to-end in mock mode.
- Frontend↔backend wiring: name-key normalization verified to match between
  the two; payload shape confirmed; orientation flip handled.

## Open next steps (rough priority)
1. **Run frontend standalone.** It was an artifact. Scaffold a Vite React app and
   wire `wc2026.jsx` as the main component so it runs outside the Claude UI.
2. **Knockout bracket.** Group stage only right now. Add a bracket that seeds from
   projected group finishers (top 2 + best thirds — note the 32-team R32 format)
   and runs the same model through to the final. `GET /predict` already does
   arbitrary pairings, so the backend mostly supports this; it's mainly frontend
   + advancement logic.
3. **Editable results tracking.** Let the user enter final scores as games finish
   so group standings update from real results, not just projections. Makes it a
   living tracker. (Frontend state + a place to persist — localStorage or a backend
   store.)
4. **Provider name aliases.** Real feeds use varied country names ("Korea Republic"
   vs "South Korea", "United States" vs "USA", "Türkiye" vs "Turkey"). Extend
   `normName` in `wc2026.jsx` (and confirm backend team names) once a provider is
   chosen and you can see its exact strings — otherwise live matches won't light up.
5. **Pick a provider + go live.** Sportmonks All-In has native live xG (best for the
   in-play model); API-Football is cheaper but xG is inconsistent so the model leans
   on the strength prior. Set `PROVIDER` + key in `.env`, restart. No frontend change.

## Gotchas
- The static model has no injury/form/lineup awareness — it's a strength baseline.
- Scorer percentages are probabilities, not picks (≈45% = roughly even odds to score).
- Mock mode runs with no key: `PROVIDER=mock` (default). Great for building UI
  without paying for data.
- FIFA strength values are seeded from April 2026 points; refresh if desired.

## Quick start
```bash
cd wc-prediction-api
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
# open the frontend, paste http://localhost:8000 into the connection bar, Connect
```
