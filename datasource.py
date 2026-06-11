"""
datasource.py — pluggable live-data layer.

The rest of the app only knows about GameState. Each provider implements
fetch_live() -> list[GameState]. Swap provider by changing ONE line in
config (PROVIDER) and adding your key. A MockProvider is included so you
can run the whole stack with zero API key and watch a fake match tick.

To wire a real provider:
  1. pick the class (SportmonksProvider / ApiFootballProvider)
  2. put your key in the .env file (see .env.example)
  3. set PROVIDER in config below
The _map_* methods are where you adjust field names if a provider's JSON
shape differs from what's assumed here — those are the only lines to touch.
"""

from __future__ import annotations
import os
import time
import random
from typing import Protocol
import requests

from model import GameState


class DataSource(Protocol):
    def fetch_live(self) -> list[GameState]: ...


# ---------------------------------------------------------------------------
# MOCK — runs with no API key. Simulates one match advancing in real time.
# ---------------------------------------------------------------------------
class MockProvider:
    def __init__(self) -> None:
        self._t0 = time.time()
        self._home_goals = 0
        self._away_goals = 0
        self._next_goal_at = random.uniform(20, 40)

    def fetch_live(self) -> list[GameState]:
        # 1 real second = 1 match minute, looping at 95'
        minute = int((time.time() - self._t0) % 95)
        if minute >= self._next_goal_at and self._home_goals + self._away_goals < 5:
            if random.random() < 0.6:
                self._home_goals += 1
            else:
                self._away_goals += 1
            self._next_goal_at = minute + random.uniform(15, 35)
        status = "NS" if minute == 0 else ("FT" if minute >= 90 else "LIVE")
        return [GameState(
            home="USA", away="Paraguay", minute=minute,
            home_goals=self._home_goals, away_goals=self._away_goals,
            home_xg_live=round(minute * 0.022, 2),
            away_xg_live=round(minute * 0.011, 2),
            status=status,
        )]


# ---------------------------------------------------------------------------
# SPORTMONKS — has live xG on the All-In / World Cup plan.
# Docs: https://docs.sportmonks.com/football
# ---------------------------------------------------------------------------
class SportmonksProvider:
    BASE = "https://api.sportmonks.com/v3/football"

    def __init__(self, api_key: str) -> None:
        self.key = api_key

    def fetch_live(self) -> list[GameState]:
        url = f"{self.BASE}/livescores/inplay"
        params = {
            "api_token": self.key,
            # pull the related data we map below
            "include": "participants;scores;statistics;events",
        }
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        return [self._map(m) for m in r.json().get("data", [])]

    def _map(self, m: dict) -> GameState:
        # NOTE: adjust these accessors to match the exact JSON your plan returns.
        parts = m.get("participants", [])
        home = next((p["name"] for p in parts
                     if p.get("meta", {}).get("location") == "home"), "Home")
        away = next((p["name"] for p in parts
                     if p.get("meta", {}).get("location") == "away"), "Away")
        scores = m.get("scores", [])
        hg = _sm_score(scores, "home")
        ag = _sm_score(scores, "away")
        minute = (m.get("periods", [{}])[-1].get("minutes")
                  or m.get("minute") or 0)
        return GameState(
            home=home, away=away, minute=int(minute),
            home_goals=hg, away_goals=ag,
            status=_sm_status(m.get("state", {}).get("short_name", "")),
        )


def _sm_score(scores: list, side: str) -> int:
    for s in scores:
        if s.get("description") == "CURRENT" and s.get("score", {}).get("participant") == side:
            return int(s["score"].get("goals", 0))
    return 0


def _sm_status(short: str) -> str:
    return {"NS": "NS", "INPLAY": "LIVE", "HT": "HT", "FT": "FT"}.get(short, "LIVE")


# ---------------------------------------------------------------------------
# API-FOOTBALL PRO — live xG and red-card statistics via Pro plan.
# Docs: https://www.api-football.com/documentation-v3
# Requires a Pro subscription for expected_goals in /fixtures/statistics.
# ---------------------------------------------------------------------------
class ApiFootballProvider:
    BASE = "https://v3.football.api-sports.io"

    def __init__(self, api_key: str) -> None:
        self._headers = {"x-apisports-key": api_key}

    def fetch_live(self) -> list[GameState]:
        r = requests.get(
            f"{self.BASE}/fixtures",
            headers=self._headers,
            params={"live": "all"},
            timeout=10,
        )
        r.raise_for_status()
        states = []
        for m in r.json().get("response", []):
            fid     = m["fixture"]["id"]
            home_id = m["teams"]["home"]["id"]
            away_id = m["teams"]["away"]["id"]
            xg_h, xg_a, rc_h, rc_a = self._fetch_stats(fid, home_id, away_id)
            states.append(self._map(m, xg_h, xg_a, rc_h, rc_a))
        return states

    def _fetch_stats(
        self, fixture_id: int, home_id: int, away_id: int
    ) -> tuple:
        """Pull xG and red cards from the Pro statistics endpoint.

        Returns (xg_home, xg_away, rc_home, rc_away).  Any value that the
        provider doesn't supply comes back as None / 0 — the model degrades
        gracefully in both cases.
        """
        try:
            r = requests.get(
                f"{self.BASE}/fixtures/statistics",
                headers=self._headers,
                params={"fixture": fixture_id},
                timeout=8,
            )
            if not r.ok:
                return None, None, 0, 0
            xg_h = xg_a = None
            rc_h = rc_a = 0
            for entry in r.json().get("response", []):
                tid = entry["team"]["id"]
                for stat in entry.get("statistics", []):
                    stype = stat.get("type", "")
                    val   = stat.get("value")
                    if stype == "expected_goals" and val not in (None, ""):
                        if tid == home_id:
                            xg_h = float(val)
                        elif tid == away_id:
                            xg_a = float(val)
                    elif stype == "Red Cards" and val:
                        if tid == home_id:
                            rc_h = int(val)
                        elif tid == away_id:
                            rc_a = int(val)
            return xg_h, xg_a, rc_h, rc_a
        except Exception:
            return None, None, 0, 0

    def _map(
        self, m: dict,
        xg_home: float | None, xg_away: float | None,
        home_red: int, away_red: int,
    ) -> GameState:
        teams, goals, fx = m["teams"], m["goals"], m["fixture"]
        return GameState(
            home=teams["home"]["name"],
            away=teams["away"]["name"],
            minute=int((fx.get("status", {}).get("elapsed") or 0)),
            home_goals=int(goals.get("home") or 0),
            away_goals=int(goals.get("away") or 0),
            home_red=home_red,
            away_red=away_red,
            home_xg_live=xg_home,
            away_xg_live=xg_away,
            status=_af_status(fx.get("status", {}).get("short", "")),
        )


def _af_status(short: str) -> str:
    if short in ("1H", "2H", "ET", "LIVE"):
        return "LIVE"
    if short == "HT":
        return "HT"
    if short in ("FT", "AET", "PEN"):
        return "FT"
    return "NS"


# ---------------------------------------------------------------------------
def get_source() -> DataSource:
    provider = os.getenv("PROVIDER", "mock").lower()
    if provider == "sportmonks":
        return SportmonksProvider(os.environ["SPORTMONKS_KEY"])
    if provider == "apifootball":
        return ApiFootballProvider(os.environ["APIFOOTBALL_KEY"])
    return MockProvider()
