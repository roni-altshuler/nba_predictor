"""The projected playoff bracket — who lands in each seed, and who advances.

This is the forward-looking twin of `series.py`, which reconstructs brackets
that have already been played. It answers a different question and has to be
careful about the difference, because the two are easy to conflate on a page
that draws them with the same component.

**A projected bracket is not a prediction of eight specific series.** Seeding
is itself uncertain, and by the conference semi-finals the pairings depend on
results that have not happened. So this module publishes exactly two things
and refuses to blur them:

1. **The modal first round.** The most likely occupant of each seed, and the
   four matchups that seeding implies, each with an EXACT best-of-seven
   probability from `series_probability` rather than a simulated estimate.
   Every seed carries `p_seed` — the probability that team actually lands
   there — so a reader can see that a projected 4/5 matchup is a coin flip
   about *who is even in it*.

2. **Marginal round-reach probabilities**, straight from the Monte Carlo.
   These integrate over every seeding the simulation produced, which is why
   they are the honest number for anything past round one. Reading a fixed
   bracket forward instead — "the 1 seed beats the 8, then plays the winner
   of 4/5" — would compound a seeding assumption four rounds deep and
   publish it as a championship probability.

The greedy seed assignment below is a *display* choice, not a model output.
It maximises the probability of each seed independently in descending order
of confidence, which is the standard way projection sites pick a modal
bracket; it is not the most likely joint seeding, and nothing downstream
consumes it as one.
"""

from __future__ import annotations

import logging
from typing import Callable, Dict, List, Optional, Sequence

from backend.services.playoffs.series import (
    HOME_PATTERN_2_2_1_1_1,
    series_length_distribution,
    series_probability,
)

logger = logging.getLogger(__name__)

# The eight bracket slots, paired so the 1 and 2 seeds can only meet in the
# conference finals. Same ordering the simulator uses; a mismatch between the
# drawn bracket and the simulated one would be invisible on the page.
FIRST_ROUND_PAIRS = ((1, 8), (4, 5), (3, 6), (2, 7))

PLAYOFF_SEEDS = 8


def assign_projected_seeds(
    teams: Sequence[Dict], *, slots: int = PLAYOFF_SEEDS
) -> List[Dict]:
    """Pick the modal occupant of seeds 1..`slots` for one conference.

    `teams` are projection dicts carrying `seed_distribution` (a mapping of
    seed → probability) and `wins`. Assignment is greedy over the strongest
    (team, seed) claims: the single most confident claim in the conference is
    honoured first, then the next, skipping any team already placed or seed
    already filled.

    Seeds nobody claims fall back to the best unplaced team by projected
    wins, with `p_seed` reported as the real (possibly zero) probability
    rather than being left blank — a seed shown without a number invites the
    reader to assume certainty.
    """
    claims = []
    for team in teams:
        distribution = team.get("seed_distribution") or {}
        for seed_key, probability in distribution.items():
            seed = int(seed_key)
            if 1 <= seed <= slots:
                claims.append((float(probability), seed, team))
    # Sort by confidence, then by projected wins so ties resolve on strength
    # rather than on dict order — the same reason the simulator jitters its
    # tiebreak instead of sorting by team id.
    claims.sort(key=lambda c: (-c[0], -float(c[2].get("wins", 0.0))))

    placed: Dict[int, Dict] = {}
    used: set = set()
    for probability, seed, team in claims:
        tid = team["team_id"]
        if seed in placed or tid in used:
            continue
        placed[seed] = {"team": team, "p_seed": probability}
        used.add(tid)

    remaining = sorted(
        (t for t in teams if t["team_id"] not in used),
        key=lambda t: -float(t.get("wins", 0.0)),
    )
    for seed in range(1, slots + 1):
        if seed in placed:
            continue
        if not remaining:
            break
        team = remaining.pop(0)
        distribution = team.get("seed_distribution") or {}
        placed[seed] = {
            "team": team,
            "p_seed": float(distribution.get(str(seed), 0.0)),
        }
        used.add(team["team_id"])

    return [
        {"seed": seed, **placed[seed]} for seed in sorted(placed)
    ]


def project_first_round(
    seeds: Sequence[Dict],
    *,
    game_probability: Callable[[float, float], float],
    elo: Dict[int, float],
    pattern: Sequence[bool] = HOME_PATTERN_2_2_1_1_1,
) -> List[Dict]:
    """The four modal first-round series, priced exactly.

    `game_probability(home_elo, away_elo)` must be the SAME function the
    season simulation uses for a single game. Pricing the bracket with a
    second implementation is how a site ends up showing a series probability
    that disagrees with its own season projection.
    """
    by_seed = {item["seed"]: item for item in seeds}
    out: List[Dict] = []
    for high_seed, low_seed in FIRST_ROUND_PAIRS:
        high = by_seed.get(high_seed)
        low = by_seed.get(low_seed)
        if not high or not low:
            continue
        high_id = high["team"]["team_id"]
        low_id = low["team"]["team_id"]
        high_elo = elo.get(high_id)
        low_elo = elo.get(low_id)
        if high_elo is None or low_elo is None:
            logger.warning(
                "no rating for %s or %s — skipping the %d/%d series",
                high_id, low_id, high_seed, low_seed,
            )
            continue

        # Two different numbers, which is the whole reason a series is not a
        # binomial: the higher seed's chance at home and its chance away.
        p_home = game_probability(high_elo, low_elo)
        p_away = 1.0 - game_probability(low_elo, high_elo)
        p_series = series_probability(p_home, p_away, pattern=pattern)
        lengths = series_length_distribution(p_home, p_away, pattern=pattern)

        out.append(
            {
                "high_seed": high_seed,
                "low_seed": low_seed,
                "high": _side(high, high_elo),
                "low": _side(low, low_elo),
                "p_high_game_home": round(p_home, 4),
                "p_high_game_away": round(p_away, 4),
                "p_high_series": round(p_series, 4),
                "p_low_series": round(1.0 - p_series, 4),
                "modal_length": _modal_length(lengths),
                "lengths": lengths,
            }
        )
    return out


def _side(entry: Dict, elo: float) -> Dict:
    team = entry["team"]
    return {
        "team_id": team["team_id"],
        "name": team.get("name"),
        "abbreviation": team.get("abbreviation"),
        "logo": team.get("logo"),
        "wins": team.get("wins"),
        "losses": team.get("losses"),
        "elo": round(float(elo), 1),
        "p_seed": round(float(entry["p_seed"]), 4),
    }


def _modal_length(lengths: Dict[str, float]) -> Optional[int]:
    """The most likely number of games, across both winners.

    "In six" is the modal outcome of most real series and a reader
    recognises it, where a bare probability is abstract.
    """
    totals: Dict[int, float] = {}
    for key, probability in lengths.items():
        try:
            games = int(key.rsplit("_", 1)[-1])
        except ValueError:
            continue
        totals[games] = totals.get(games, 0.0) + probability
    if not totals:
        return None
    return max(totals.items(), key=lambda kv: kv[1])[0]
