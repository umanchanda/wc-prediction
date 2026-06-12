"""
model.py — World Cup 2026 live prediction model.

Two regimes that blend as a match progresses:

  pre-match   : expected goals from team strength (FIFA-points based)
  in-play     : score is fixed; only the REMAINING minutes are modeled,
                adjusted for red cards and (if available) live xG.

Early in a match the strength prior dominates. As time elapses and goals
land, the fixed current score takes over and the prediction converges on
the actual result — which is exactly how a live win-probability should behave.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional

# --- team strength ----------------------------------------------------------
# Seed values from April 2026 FIFA points (extend freely).
FIFA_POINTS = {
    "France": 1877, "Spain": 1876, "Argentina": 1875, "England": 1826,
    "Portugal": 1764, "Brazil": 1761, "Netherlands": 1758, "Morocco": 1756,
    "Belgium": 1735, "Germany": 1730, "Croatia": 1717, "Italy": 1700,
    "Colombia": 1693, "Senegal": 1689, "Mexico": 1681, "USA": 1673,
    "Uruguay": 1673, "Japan": 1660, "Switzerland": 1649, "Denmark": 1621,
    "Iran": 1600, "South Korea": 1585, "Ecuador": 1570, "Austria": 1560,
    "Turkiye": 1550, "Australia": 1540, "Canada": 1535, "Ukraine": 1520,
    "Norway": 1510, "Panama": 1500, "Poland": 1495, "Wales": 1485,
    "Algeria": 1470, "Egypt": 1465, "Serbia": 1455, "Nigeria": 1450,
    "Paraguay": 1440, "Bosnia and Herzegovina": 1430, "Tunisia": 1420,
    "Ivory Coast": 1415, "Sweden": 1410, "Czechia": 1405, "Slovakia": 1395,
    "Qatar": 1330, "Uzbekistan": 1310, "Iraq": 1300, "Saudi Arabia": 1290,
    "South Africa": 1280, "Jordan": 1255, "Cape Verde": 1235, "Ghana": 1215,
    "Curacao": 1140, "Haiti": 1130, "New Zealand": 1115,
    "Scotland": 1385, "DR Congo": 1290,
}

HOSTS = {"USA", "Mexico", "Canada"}
BASE_GOALS = 1.35          # avg goals per team per match
STRENGTH_K = 0.32          # how sharply rating gap maps to goals
HOST_BUMP = 1.12
FULL_TIME = 90.0


def _rating(team: str) -> float:
    pts = FIFA_POINTS.get(team, 1400)   # unknown team -> weak-ish default
    return (pts - 1500) / 110.0


def _clamp(x: float, lo: float = 0.05, hi: float = 5.0) -> float:
    return max(lo, min(hi, x))


def prematch_expected_goals(home: str, away: str) -> tuple[float, float]:
    """Full-90 expected goals for each side, before kickoff."""
    rh, ra = _rating(home), _rating(away)
    lam_h = BASE_GOALS * math.exp(STRENGTH_K * (rh - ra))
    lam_a = BASE_GOALS * math.exp(STRENGTH_K * (ra - rh))
    if home in HOSTS:
        lam_h *= HOST_BUMP
    if away in HOSTS:
        lam_a *= HOST_BUMP
    return _clamp(lam_h), _clamp(lam_a)


# --- live game state --------------------------------------------------------

@dataclass
class GameState:
    home: str
    away: str
    minute: int = 0                 # 0 = not started
    home_goals: int = 0
    away_goals: int = 0
    home_red: int = 0               # red cards conceded
    away_red: int = 0
    # optional live xG from a provider; None => fall back to strength only
    home_xg_live: Optional[float] = None
    away_xg_live: Optional[float] = None
    status: str = "NS"              # NS, LIVE, HT, FT


def _poisson_pmf(k: int, lam: float) -> float:
    return math.exp(-lam) * lam ** k / math.factorial(k)


def remaining_lambdas(gs: GameState) -> tuple[float, float]:
    """
    Expected goals over the MINUTES STILL TO BE PLAYED, adjusted for red cards.
    This is the heart of the live model: a 1-0 lead with 5 minutes left leaves
    almost no remaining lambda, so the result is nearly locked.
    """
    pm_h, pm_a = prematch_expected_goals(gs.home, gs.away)

    if gs.status in ("NS",) or gs.minute <= 0:
        return pm_h, pm_a   # full match still to play

    minutes_left = max(0.0, FULL_TIME - min(gs.minute, FULL_TIME))
    frac = minutes_left / FULL_TIME

    # base: per-minute pre-match rate, scaled to remaining time
    rem_h = pm_h * frac
    rem_a = pm_a * frac

    # blend in live xG signal if the provider gives it.
    # live xG tells us how the game is ACTUALLY flowing vs the prior.
    if gs.home_xg_live is not None and gs.minute > 15:
        # observed scoring rate so far, projected onto remaining minutes
        rate_h = gs.home_xg_live / max(gs.minute, 1)
        rem_h = 0.5 * rem_h + 0.5 * (rate_h * minutes_left)
    if gs.away_xg_live is not None and gs.minute > 15:
        rate_a = gs.away_xg_live / max(gs.minute, 1)
        rem_a = 0.5 * rem_a + 0.5 * (rate_a * minutes_left)

    # red-card penalty: a team down to 10 scores less, concedes more.
    if gs.home_red > 0:
        rem_h *= 0.72 ** gs.home_red
        rem_a *= 1.18 ** gs.home_red
    if gs.away_red > 0:
        rem_a *= 0.72 ** gs.away_red
        rem_h *= 1.18 ** gs.away_red

    return _clamp(rem_h, 0.0), _clamp(rem_a, 0.0)


@dataclass
class Prediction:
    home: str
    away: str
    minute: int
    p_home: float
    p_draw: float
    p_away: float
    exp_home_goals: float          # final projected (current + remaining)
    exp_away_goals: float
    exp_total: float
    p_over_2_5: float
    top_scorelines: list = field(default_factory=list)
    live: bool = False


def predict(gs: GameState, grid: int = 10) -> Prediction:
    """
    Compute outcome probabilities from current score + remaining-minute goals.
    Final score = (goals already scored) + (Poisson draws over remaining time).
    """
    rem_h, rem_a = remaining_lambdas(gs)

    p_home = p_draw = p_away = 0.0
    p_over = 0.0
    score_probs: dict[tuple[int, int], float] = {}

    for add_h in range(grid + 1):
        for add_a in range(grid + 1):
            p = _poisson_pmf(add_h, rem_h) * _poisson_pmf(add_a, rem_a)
            fh = gs.home_goals + add_h
            fa = gs.away_goals + add_a
            if fh > fa:
                p_home += p
            elif fh == fa:
                p_draw += p
            else:
                p_away += p
            if fh + fa >= 3:
                p_over += p
            score_probs[(fh, fa)] = score_probs.get((fh, fa), 0.0) + p

    top = sorted(score_probs.items(), key=lambda kv: kv[1], reverse=True)[:3]
    exp_h = gs.home_goals + rem_h
    exp_a = gs.away_goals + rem_a

    return Prediction(
        home=gs.home, away=gs.away, minute=gs.minute,
        p_home=round(p_home, 4), p_draw=round(p_draw, 4), p_away=round(p_away, 4),
        exp_home_goals=round(exp_h, 2), exp_away_goals=round(exp_a, 2),
        exp_total=round(exp_h + exp_a, 2), p_over_2_5=round(p_over, 4),
        top_scorelines=[{"score": f"{h}-{a}", "p": round(pp, 4)} for (h, a), pp in top],
        live=gs.status in ("LIVE", "HT"),
    )


# quick self-test when run directly
if __name__ == "__main__":
    import json
    demos = [
        GameState("France", "Haiti", status="NS"),
        GameState("Argentina", "Spain", status="NS"),
        GameState("USA", "Paraguay", minute=70, home_goals=1, away_goals=0, status="LIVE"),
        GameState("USA", "Paraguay", minute=88, home_goals=0, away_goals=1, status="LIVE"),
        GameState("Brazil", "Germany", minute=30, home_goals=0, away_goals=0,
                  away_red=1, status="LIVE"),
    ]
    for d in demos:
        p = predict(d)
        print(f"{d.home} vs {d.away} ({d.minute}') "
              f"H {p.p_home:.0%} D {p.p_draw:.0%} A {p.p_away:.0%} "
              f"| proj {p.exp_home_goals}-{p.exp_away_goals}")
