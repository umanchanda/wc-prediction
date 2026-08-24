# Premier League 2026-27 Predictor

A FastAPI and React app that fetches Premier League fixtures through
[PyFotMob](https://pypi.org/project/pyfotmob/) and predicts a scoreline for
every upcoming match.

The model learns separate home/away attacking and defensive rates from completed
2026-27 fixtures, applies shrinkage to league averages early in the season, and
uses independent Poisson goal distributions to select the most likely scoreline.
It also returns home-win, draw, and away-win probabilities.

## Set up

```powershell
python -m pip install -r requirements.txt
# PyFotMob 0.0.3 declares an incompatible unused Pydantic dependency.
python -m pip install --no-deps pyfotmob==0.0.3
```

Create `.env` with the FotMob IDs for the 20 clubs in this season:

```dotenv
FOTMOB_TEAM_IDS=9825,8455,...
```

The published PyFotMob 0.0.3 wheel omits an internal `services.data` module.
This repository includes a minimal compatibility module so its documented
`Team(id).get()` interface works unchanged.

## Run

```powershell
python -m uvicorn server:app --reload --port 8000
```

Then sync current fixtures:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/fixtures/sync
```

The sync stores `data/fixtures-2026-27.json`, allowing predictions to remain
available without another provider request. Open the frontend through the
FastAPI server after building it, or point Vite's `VITE_API_URL` at the API.

## API

- `POST /fixtures/sync` fetches and caches the 2026-27 fixture list.
- `GET /fixtures` returns the cached fixtures.
- `GET /predictions` returns a predicted scoreline for every unplayed fixture.
- `GET /predictions?round=1` filters predictions to a matchweek.
- `GET /healthz` reports the cache state.

## Validate

```powershell
python -m unittest discover -s tests -v
```
