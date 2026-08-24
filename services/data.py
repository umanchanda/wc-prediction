"""HTTP transport expected by PyFotMob 0.0.3.

The released wheel imports ``services.data`` but does not package it.  This
small compatibility module restores the documented ``Team(...).get()`` API
without changing PyFotMob's public interface.
"""

from __future__ import annotations

from typing import Any

import requests


def handle_league_match_player_team(*, entity: str, url: str, id: int, key: str | None = None) -> dict[str, Any]:
    response = requests.get(url, timeout=20, headers={"User-Agent": "pl-prediction/1.0"})
    response.raise_for_status()
    payload = response.json()
    if key is not None:
        return payload[key]
    return payload
