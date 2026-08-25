"""HTTP transport expected by PyFotMob 0.0.3.

The released wheel imports ``services.data`` but does not package it.  This
small compatibility module restores the documented ``Team(...).get()`` API
without changing PyFotMob's public interface.
"""

from __future__ import annotations

import json
import re
from typing import Any

import requests


def handle_league_match_player_team(*, entity: str, url: str, id: int, key: str | None = None) -> dict[str, Any]:
    response = requests.get(
        f"https://www.fotmob.com/api/teams/{id}" if entity == "team" else url,
        timeout=20,
        headers={"User-Agent": "Mozilla/5.0 (compatible; pl-prediction/1.0)"},
    )
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError:
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', response.text)
        if match is None:
            raise ValueError("FotMob returned a response without team data") from None
        payload = json.loads(match.group(1))
    if key is not None:
        return payload[key]
    return payload
