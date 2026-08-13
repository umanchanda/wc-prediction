"""
model.py — Premier League 2026-27 live prediction model.

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

# --- team strength (Premier League clubs - approximate ratings) ----------
CLUB_RATINGS = {
    "Arsenal": 1850, "Manchester City": 1900, "Manchester United": 1760,
    "Liverpool": 1840, "Chelsea": 1720, "Tottenham": 1780, "Newcastle United": 1765,
    "Aston Villa": 1700, "West Ham United": 1650, "Brighton": 1690,
    "Brentford": 1630, "Wolves": 1600, "Fulham": 1580, "Crystal Palace": 1560,
    "Everton": 1550, "Leicester City": 1540, "Nottingham Forest": 1500,
    "Bournemouth": 1490, "Burnley": 1470, "Luton Town": 1450,
}

BASE_GOALS = 1.35          # avg goals per team per match
STRENGTH_K = 1.2          # how sharply rating gap maps to goals (club scale)
HOME_BUMP = 1.12
FULL_TIME = 90.0


def _rating(team: str) -> float:
    pts = CLUB_RATINGS.get(team, 1400)   # unknown club -> weak-ish default
    return (pts - 1500) / 200.0


def _clamp(x: float, lo: float = 0.05, hi: float = 5.0) -> float:
    return max(lo, min(hi, x))


def prematch_expected_goals(home: str, away: str) -> tuple[float, float]:
    """Full-90 expected goals for each side, before kickoff."""
    rh, ra = _rating(home), _rating(away)
    lam_h = BASE_GOALS * math.exp(STRENGTH_K * (rh - ra))
    lam_a = BASE_GOALS * math.exp(STRENGTH_K * (ra - rh))
    # home advantage for the home side
    lam_h *= HOME_BUMP
    return _clamp(lam_h), _clamp(lam_a)


# --- season Monte Carlo (utility used by backend endpoint) ------------------
def _sample_poisson(lam: float) -> int:
    import random
    if lam <= 0:
        return 0
    L = math.exp(-lam)
    k = 0
    p = 1.0
    while p > L:
        k += 1
        p *= random.random()
    return k - 1


def _generate_matchdays(teams: list[str]) -> list[list[tuple[str, str]]]:
    """Circle-method round-robin schedule, returns rounds with (home, away)."""
    t = teams[:]
    n = len(t)
    if n % 2 != 0:
        t = t + ["BYE"]
    N = len(t)
    arr = t[:]
    rounds: list[list[tuple[str, str]]] = []
    for r in range(N - 1):
        pairs: list[tuple[str, str]] = []
        for i in range(N // 2):
            a = arr[i]
            b = arr[N - 1 - i]
            if a != "BYE" and b != "BYE":
                if r % 2 == 0:
                    pairs.append((a, b))
                else:
                    pairs.append((b, a))
        rounds.append(pairs)
        arr.insert(1, arr.pop())
    # mirror
    second = [[(away, home) for (home, away) in rnd] for rnd in rounds]
    return rounds + second


def run_season_montecarlo(sims: int = 1500) -> dict:
    """Run full-season Monte Carlo on club ratings and return summary.

    Returns: {"sims": int, "avgPoints": {team: float}, "rankCounts": {team: [counts...]}}
    """
    import random

    teams = list(CLUB_RATINGS.keys())
    rounds = _generate_matchdays(teams)
    matches = [m for rnd in rounds for m in rnd]
    nteams = len(teams)

    rank_counts: dict[str, list[int]] = {t: [0] * nteams for t in teams}
    avg_points: dict[str, float] = {t: 0.0 for t in teams}

    for s in range(sims):
        pts = {t: 0 for t in teams}
        for (home, away) in matches:
            lam_h, lam_a = prematch_expected_goals(home, away)
            gh = _sample_poisson(lam_h)
            ga = _sample_poisson(lam_a)
            if gh > ga:
                pts[home] += 3
            elif gh < ga:
                pts[away] += 3
            else:
                pts[home] += 1
                pts[away] += 1

        table = sorted(teams, key=lambda t: (-pts[t], t))
        for idx, t in enumerate(table):
            rank_counts[t][idx] += 1
            avg_points[t] += pts[t]

    for t in teams:
        avg_points[t] = round(avg_points[t] / sims, 1)

    return {"sims": sims, "avgPoints": avg_points, "rankCounts": rank_counts}


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
