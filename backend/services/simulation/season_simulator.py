"""Monte Carlo season projection.

Simulates the remainder of a season game by game, then the play-in, then the
playoff bracket, and reports for every franchise: expected wins, conference
seed distribution, playoff/play-in odds, conference title odds and
championship odds.

**The one decision that must not be casually changed.**

Each simulation draws ONE strength offset per franchise and holds it for the
whole season, rather than perturbing each game independently. This is
inherited from the soccer project, where compounding point estimates over 34
matchdays gave Bayern 93.3% against a market price near 70%, and it matters
more here, not less: 82 games compound the error twice as far.

The offset's size is measured, not assumed. Within-season Elo drift over
**689 team-seasons has sd 36.1 rating points** (`tune_elo.py` →
`within_season_drift`), and — the part that makes independent per-game noise
the wrong model — that error is *correlated across all of a team's games*.
A team that is better than its rating is better in all 82, so no number of
simulations averages it away.

Soccer's measured figure was 45.3; using it here would be a 25%
overstatement of NBA uncertainty. **Do not port the constant.**

**Per-game probabilities stay unperturbed.** The margin model was measured
at ECE .0114 on exactly those inputs, and the shock exists to widen the
*season* distribution, not to make each game less certain.

**Every season seeds its own RNG** from `sha256(season)`. One shared
generator consumed in dict-iteration order means adding a team moves an
unrelated team's title odds with nothing having changed about it. Two runs
of this module are byte-identical.
"""

from __future__ import annotations

import hashlib
import logging
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Measured: sd of a franchise's Elo around its own season mean, over 689
# team-seasons on the 2004-2026 corpus. Converted from rating points to the
# log-odds scale the win probability lives on.
SEASON_ELO_DRIFT_SD = 36.1
STRENGTH_SHOCK_SD = SEASON_ELO_DRIFT_SD / 400.0 * math.log(10) / 2.0

REGULAR_SEASON_GAMES = 82

# Seeds 1-6 qualify directly; 7-10 enter the play-in. Read from the league's
# actual format rather than hard-coded at the call sites, because a literal
# 6 stops being true the year the format changes and nothing would say so.
DIRECT_PLAYOFF_SEEDS = 6
PLAY_IN_SEEDS = 10
PLAYOFF_SEEDS = 8


@dataclass
class TeamProjection:
    team_id: int
    name: str
    conference: str
    wins: float
    losses: float
    wins_p10: float
    wins_p90: float
    p_playoffs: float
    p_play_in: float
    p_top_seed: float
    p_conference_title: float
    p_championship: float
    seed_distribution: Dict[int, float]
    current_wins: int
    current_losses: int
    games_left: int
    elo: float

    def as_dict(self) -> Dict:
        return {
            "team_id": self.team_id,
            "name": self.name,
            "conference": self.conference,
            "wins": round(self.wins, 2),
            "losses": round(self.losses, 2),
            "wins_p10": round(self.wins_p10, 1),
            "wins_p90": round(self.wins_p90, 1),
            "p_playoffs": round(self.p_playoffs, 4),
            "p_play_in": round(self.p_play_in, 4),
            "p_top_seed": round(self.p_top_seed, 4),
            "p_conference_title": round(self.p_conference_title, 4),
            "p_championship": round(self.p_championship, 4),
            "seed_distribution": {
                str(k): round(v, 4) for k, v in sorted(self.seed_distribution.items())
            },
            "current_wins": self.current_wins,
            "current_losses": self.current_losses,
            "games_left": self.games_left,
            "elo": round(self.elo, 1),
        }


@dataclass
class SeasonSimulationResult:
    season: int
    simulations: int
    teams: List[TeamProjection]
    games_played: int
    games_remaining: int
    generated_at: str

    def as_dict(self) -> Dict:
        return {
            "season": self.season,
            "simulations": self.simulations,
            "games_played": self.games_played,
            "games_remaining": self.games_remaining,
            "generated_at": self.generated_at,
            "teams": [t.as_dict() for t in self.teams],
        }


class SeasonSimulator:
    """Monte Carlo over the remaining schedule plus the postseason."""

    def __init__(
        self,
        *,
        simulations: int = 20000,
        shock_sd: float = STRENGTH_SHOCK_SD,
        home_advantage_elo: float = 50.0,
        points_per_elo: float = 28.0,
        margin_sd: float = 13.3,
    ):
        self.simulations = simulations
        self.shock_sd = shock_sd
        self.home_advantage_elo = home_advantage_elo
        self.points_per_elo = points_per_elo
        self.margin_sd = margin_sd

    # ------------------------------------------------------------- core

    def _seed(self, season: int) -> np.random.Generator:
        digest = hashlib.sha256(str(season).encode()).digest()
        return np.random.default_rng(int.from_bytes(digest[:8], "big"))

    def _win_probability(
        self, home_elo: float, away_elo: float, *, neutral: bool = False
    ) -> float:
        edge = 0.0 if neutral else self.home_advantage_elo
        margin = ((home_elo + edge) - away_elo) / self.points_per_elo
        # Same continuity correction as the served model, so a simulated
        # season and a published game forecast cannot disagree about the
        # same matchup.
        return 1.0 - _normal_cdf((0.5 - margin) / self.margin_sd)

    def simulate(
        self,
        *,
        season: int,
        teams: Dict[int, Dict],
        standings: Dict[int, Tuple[int, int]],
        remaining: Sequence[Tuple[int, int]],
        generated_at: str,
    ) -> SeasonSimulationResult:
        """Run the projection.

        `teams` maps team_id → {name, conference, elo}.
        `standings` maps team_id → (wins, losses) already banked.
        `remaining` is a list of (home_team_id, away_team_id).

        **Points already banked seed the simulation**, so the projection
        tightens as the season runs rather than staying a preseason
        snapshot. A team 40-10 with 32 to play is projected from 40-10.
        """
        rng = self._seed(season)
        team_ids = sorted(teams)
        index = {tid: i for i, tid in enumerate(team_ids)}
        n_teams = len(team_ids)
        base_elo = np.array([teams[t]["elo"] for t in team_ids], dtype=float)
        conferences = [teams[t]["conference"] for t in team_ids]

        base_wins = np.array(
            [standings.get(t, (0, 0))[0] for t in team_ids], dtype=float
        )
        base_losses = np.array(
            [standings.get(t, (0, 0))[1] for t in team_ids], dtype=float
        )

        remaining_idx = [
            (index[h], index[a]) for h, a in remaining if h in index and a in index
        ]
        dropped = len(remaining) - len(remaining_idx)
        if dropped:
            logger.warning(
                "%d remaining games reference a team not in the projection", dropped
            )

        sims = self.simulations
        win_counts = np.zeros((sims, n_teams))
        seed_counts = defaultdict(lambda: np.zeros(n_teams))
        playoff_counts = np.zeros(n_teams)
        play_in_counts = np.zeros(n_teams)
        top_seed_counts = np.zeros(n_teams)
        conf_title_counts = np.zeros(n_teams)
        title_counts = np.zeros(n_teams)

        east_idx = [i for i, c in enumerate(conferences) if _is_east(c)]
        west_idx = [i for i, c in enumerate(conferences) if not _is_east(c)]

        for s in range(sims):
            # ONE offset per team for the WHOLE season. See module docstring.
            shock = rng.normal(0.0, self.shock_sd, n_teams)
            elo = base_elo + shock * 400.0 / math.log(10)

            wins = base_wins.copy()
            losses = base_losses.copy()
            for h, a in remaining_idx:
                p_home = self._win_probability(elo[h], elo[a])
                if rng.random() < p_home:
                    wins[h] += 1
                    losses[a] += 1
                else:
                    wins[a] += 1
                    losses[h] += 1
            win_counts[s] = wins

            champion: Optional[int] = None
            conf_winners: List[int] = []
            for conf_members in (east_idx, west_idx):
                if len(conf_members) < PLAYOFF_SEEDS:
                    continue
                # Tie-break by a tiny deterministic jitter rather than by
                # dict order: real tiebreakers are head-to-head and
                # conference record, which this model does not carry, and
                # ordering by team id would systematically favour Atlanta.
                order = sorted(
                    conf_members,
                    key=lambda i: (-wins[i], -elo[i], rng.random()),
                )
                for rank, team in enumerate(order[:PLAY_IN_SEEDS], start=1):
                    seed_counts[rank][team] += 1
                if order:
                    top_seed_counts[order[0]] += 1
                for team in order[:DIRECT_PLAYOFF_SEEDS]:
                    playoff_counts[team] += 1
                for team in order[DIRECT_PLAYOFF_SEEDS:PLAY_IN_SEEDS]:
                    play_in_counts[team] += 1

                bracket_seeds = self._resolve_play_in(order, elo, rng)
                for team in bracket_seeds[DIRECT_PLAYOFF_SEEDS:]:
                    playoff_counts[team] += 1
                winner = self._simulate_bracket(bracket_seeds, elo, rng)
                conf_title_counts[winner] += 1
                conf_winners.append(winner)

            if len(conf_winners) == 2:
                a, b = conf_winners
                # The Finals are seeded by record, so home court goes to the
                # better regular-season team — not to a fixed conference.
                home, away = (a, b) if wins[a] >= wins[b] else (b, a)
                champion = self._simulate_series(home, away, elo, rng)
                title_counts[champion] += 1

        projections: List[TeamProjection] = []
        games_left_by_team = defaultdict(int)
        for h, a in remaining_idx:
            games_left_by_team[h] += 1
            games_left_by_team[a] += 1

        for tid in team_ids:
            i = index[tid]
            distribution = {
                rank: float(seed_counts[rank][i] / sims)
                for rank in sorted(seed_counts)
                if seed_counts[rank][i] > 0
            }
            projections.append(
                TeamProjection(
                    team_id=tid,
                    name=teams[tid]["name"],
                    conference=teams[tid]["conference"],
                    wins=float(win_counts[:, i].mean()),
                    losses=float(REGULAR_SEASON_GAMES - win_counts[:, i].mean()),
                    wins_p10=float(np.percentile(win_counts[:, i], 10)),
                    wins_p90=float(np.percentile(win_counts[:, i], 90)),
                    p_playoffs=float(playoff_counts[i] / sims),
                    p_play_in=float(play_in_counts[i] / sims),
                    p_top_seed=float(top_seed_counts[i] / sims),
                    p_conference_title=float(conf_title_counts[i] / sims),
                    p_championship=float(title_counts[i] / sims),
                    seed_distribution=distribution,
                    current_wins=int(base_wins[i]),
                    current_losses=int(base_losses[i]),
                    games_left=games_left_by_team[i],
                    elo=float(base_elo[i]),
                )
            )

        projections.sort(key=lambda p: (-p.p_championship, -p.wins))
        return SeasonSimulationResult(
            season=season,
            simulations=sims,
            teams=projections,
            games_played=int(base_wins.sum() + base_losses.sum()) // 2,
            games_remaining=len(remaining_idx),
            generated_at=generated_at,
        )

    # --------------------------------------------------------- postseason

    def _resolve_play_in(
        self, order: Sequence[int], elo: np.ndarray, rng: np.random.Generator
    ) -> List[int]:
        """Seeds 7-10 play in; returns the eight bracket entrants in order.

        The real format: 7v8 winner takes seed 7. 9v10 winner meets the 7v8
        loser for seed 8. Modelled exactly rather than approximated by
        "top 8 make it", because the play-in is the difference between a
        45% and a 70% playoff probability for exactly the teams a reader
        cares most about.
        """
        if len(order) < PLAY_IN_SEEDS:
            return list(order[:PLAYOFF_SEEDS])
        top = list(order[:DIRECT_PLAYOFF_SEEDS])
        seven, eight, nine, ten = order[6], order[7], order[8], order[9]

        seven_wins = rng.random() < self._win_probability(elo[seven], elo[eight])
        seed7 = seven if seven_wins else eight
        loser78 = eight if seven_wins else seven

        nine_wins = rng.random() < self._win_probability(elo[nine], elo[ten])
        winner910 = nine if nine_wins else ten

        final_home = loser78  # the 7/8 loser hosts the elimination game
        loser_wins = rng.random() < self._win_probability(
            elo[final_home], elo[winner910]
        )
        seed8 = final_home if loser_wins else winner910
        return top + [seed7, seed8]

    def _simulate_series(
        self,
        higher: int,
        lower: int,
        elo: np.ndarray,
        rng: np.random.Generator,
        *,
        best_of: int = 7,
    ) -> int:
        """Best-of-seven with the 2-2-1-1-1 home pattern.

        **Home court is modelled game by game, not as a single bonus.** A
        series is not one game with a bigger sample: the higher seed hosts
        four of seven, and collapsing that into an aggregate strength edge
        gets the 2-3-2 vs 2-2-1-1-1 distinction wrong and mis-prices every
        game-7 scenario.
        """
        needed = best_of // 2 + 1
        wins_high = wins_low = 0
        pattern = (True, True, False, False, True, False, True)
        for game in range(best_of):
            higher_home = pattern[game] if game < len(pattern) else True
            if higher_home:
                p = self._win_probability(elo[higher], elo[lower])
            else:
                p = 1.0 - self._win_probability(elo[lower], elo[higher])
            if rng.random() < p:
                wins_high += 1
            else:
                wins_low += 1
            if wins_high == needed:
                return higher
            if wins_low == needed:
                return lower
        return higher if wins_high > wins_low else lower

    def _simulate_bracket(
        self, seeds: Sequence[int], elo: np.ndarray, rng: np.random.Generator
    ) -> int:
        """One conference's four rounds. 1v8, 2v7, 3v6, 4v5, then re-pair.

        The NBA re-seeds nothing: the bracket is fixed at the first round,
        so the 1 seed does not automatically meet the lowest survivor.
        Modelled as a fixed bracket, which is what the league actually runs.
        """
        if len(seeds) < PLAYOFF_SEEDS:
            return seeds[0]
        # Bracket order pairs 1-8, 4-5 | 3-6, 2-7 so that 1 and 2 can only
        # meet in the conference finals.
        bracket = [
            seeds[0], seeds[7], seeds[3], seeds[4],
            seeds[2], seeds[5], seeds[1], seeds[6],
        ]
        while len(bracket) > 1:
            nxt = []
            for i in range(0, len(bracket), 2):
                a, b = bracket[i], bracket[i + 1]
                # The better seed hosts; seed order is the index in `seeds`.
                rank_a, rank_b = seeds.index(a), seeds.index(b)
                higher, lower = (a, b) if rank_a < rank_b else (b, a)
                nxt.append(self._simulate_series(higher, lower, elo, rng))
            bracket = nxt
        return bracket[0]


def _is_east(conference: Optional[str]) -> bool:
    return bool(conference) and "east" in str(conference).lower()


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
