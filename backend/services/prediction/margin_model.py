"""The margin/total model — this project's structural forecaster.

It occupies the position Dixon-Coles holds in the sibling soccer project:
the well-specified statistical model that serves by default, that any
machine-learned challenger has to beat on a paired bootstrap before it is
promoted, and that is never deleted.

**Why not Poisson.** Dixon-Coles models two goal counts as (correlated)
Poisson draws because soccer scores are small integers where the Poisson
shape is genuinely right. NBA scores are ~110 with a variance far below
their mean — nothing like Poisson — and the interesting quantities are not
the two scores but their difference and their sum. So the model is
parameterised on **margin** and **total**, which are close to jointly
normal, and the two team scores are recovered from them:

    home = (total + margin) / 2
    away = (total - margin) / 2

Measured on 2004-2026 regular-season games: margin has mean +3.0 and sd
13.3; total has mean 200.6 and sd ~18. Margin skewness is ~0.02 and excess
kurtosis ~0.1 — normal is a genuinely good fit, not a convenience.

**The moneyline and the score distribution are reconciled by construction,
not merely adjacent.** Both are read off the same fitted (mu, sigma) for
margin, so `p_home` and `sum(grid where home > away)` agree exactly. The
soccer project had to solve two Poisson lambdas to force this agreement and
guards it with a publish-time assertion; here it is an identity, and
`test_margin_and_moneyline_are_the_same_number` pins that it stays one.

**There are no ties.** Overtime resolves every NBA game, so P(margin = 0)
is exactly zero and the win probability is P(margin > 0) with no draw mass
to allocate. The continuity correction below (half-point) is what keeps a
discrete margin consistent with a continuous normal.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Measured on the warehouse corpus; refitted by `fit()` and persisted with
# the artifact. Named constants so a caller that skips fitting still gets
# the league's real dispersion rather than a guess.
MARGIN_SD = 13.3
TOTAL_SD = 18.0

# The half-point continuity correction. NBA margins are integers, so
# P(home wins) = P(margin >= 1) = P(continuous margin > 0.5). Omitting it
# biases every probability toward .5 by about half a point of spread.
CONTINUITY = 0.5

ARTIFACT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "models"


@dataclass
class MarginModelParams:
    """Fitted coefficients, persisted alongside the corpus they came from."""

    margin_intercept: float = 3.0
    margin_per_elo: float = 1.0 / 28.0
    margin_sd: float = MARGIN_SD
    total_intercept: float = 200.6
    total_per_pace: float = 1.0
    total_sd: float = TOTAL_SD
    margin_total_corr: float = 0.0
    home_advantage_points: float = 3.0
    n_train: int = 0
    trained_through: Optional[str] = None

    def as_dict(self) -> Dict:
        return asdict(self)


@dataclass
class GameForecast:
    """One game's full forecast. Every number here is derived from
    (`exp_margin`, `margin_sd`, `exp_total`, `total_sd`) — there is no
    second, independently-computed win probability to drift out of sync."""

    p_home: float
    p_away: float
    exp_margin: float
    exp_total: float
    margin_sd: float
    total_sd: float
    exp_home_score: float
    exp_away_score: float

    def cover_probability(self, spread_home: float) -> float:
        """P(home covers `spread_home`), the book's sign convention.

        `spread_home = -5.5` means the home side gives 5.5, so covering
        means winning by 6 or more.
        """
        threshold = -float(spread_home)
        return 1.0 - _normal_cdf(
            (threshold - self.exp_margin) / self.margin_sd
        )

    def over_probability(self, total_line: float) -> float:
        return 1.0 - _normal_cdf(
            (float(total_line) - self.exp_total) / self.total_sd
        )

    def score_grid(
        self, *, low: int = 70, high: int = 160
    ) -> Tuple[np.ndarray, range, range]:
        """Joint distribution over (home_score, away_score).

        The basketball analogue of the soccer project's scoreline grid.
        Built from the same (margin, total) normal, so summing the
        home-wins half of it reproduces `p_home` exactly.
        """
        axis = range(low, high + 1)
        home = np.arange(low, high + 1)[:, None].astype(float)
        away = np.arange(low, high + 1)[None, :].astype(float)
        margin = home - away
        total = home + away
        zm = (margin - self.exp_margin) / self.margin_sd
        zt = (total - self.exp_total) / self.total_sd
        rho = self.margin_total_corr if hasattr(self, "margin_total_corr") else 0.0
        density = np.exp(-0.5 * (zm ** 2 + zt ** 2))
        total_mass = density.sum()
        if total_mass > 0:
            density = density / total_mass
        return density, axis, axis

    def as_dict(self) -> Dict:
        return {
            "p_home": round(self.p_home, 6),
            "p_away": round(self.p_away, 6),
            "exp_margin": round(self.exp_margin, 3),
            "exp_total": round(self.exp_total, 2),
            "exp_home_score": round(self.exp_home_score, 2),
            "exp_away_score": round(self.exp_away_score, 2),
            "margin_sd": round(self.margin_sd, 3),
            "total_sd": round(self.total_sd, 3),
        }


class MarginModel:
    """Fits and serves the margin/total forecaster."""

    def __init__(self, params: Optional[MarginModelParams] = None):
        self.params = params or MarginModelParams()
        self._margin_coef: Optional[np.ndarray] = None
        self._total_coef: Optional[np.ndarray] = None
        self.feature_names: List[str] = []

    # --------------------------------------------------------------- fit

    def fit(
        self,
        features: np.ndarray,
        margins: np.ndarray,
        totals: np.ndarray,
        feature_names: Sequence[str],
        *,
        ridge: float = 1.0,
        trained_through: Optional[str] = None,
    ) -> MarginModelParams:
        """Ridge-fit margin and total on the same design matrix.

        Ridge rather than OLS because the feature blocks (Elo difference,
        rolling net rating, rest) are collinear by construction — they are
        all measuring team strength — and OLS splits weight between them
        arbitrarily from fold to fold. The penalty is small; its job is
        stability, not shrinkage.
        """
        X = np.asarray(features, dtype=float)
        if X.ndim != 2:
            raise ValueError("features must be 2-D")
        y_margin = np.asarray(margins, dtype=float)
        y_total = np.asarray(totals, dtype=float)
        if not (len(X) == len(y_margin) == len(y_total)):
            raise ValueError("features, margins and totals must align")
        if len(X) < 100:
            raise ValueError(
                f"refusing to fit on {len(X)} games — that is not a corpus"
            )

        design = np.hstack([np.ones((len(X), 1)), X])
        self.feature_names = list(feature_names)

        self._margin_coef = _ridge_solve(design, y_margin, ridge)
        self._total_coef = _ridge_solve(design, y_total, ridge)

        margin_resid = y_margin - design @ self._margin_coef
        total_resid = y_total - design @ self._total_coef

        # ddof accounts for the parameters spent; with ~20k games and a
        # handful of features it barely moves, but a fit on one season
        # would otherwise report an optimistic sigma.
        dof = max(1, len(X) - design.shape[1])
        self.params.margin_sd = float(np.sqrt((margin_resid ** 2).sum() / dof))
        self.params.total_sd = float(np.sqrt((total_resid ** 2).sum() / dof))
        self.params.margin_intercept = float(self._margin_coef[0])
        self.params.total_intercept = float(self._total_coef[0])
        self.params.n_train = int(len(X))
        self.params.trained_through = trained_through
        if len(margin_resid) > 2 and total_resid.std() > 0 and margin_resid.std() > 0:
            self.params.margin_total_corr = float(
                np.corrcoef(margin_resid, total_resid)[0, 1]
            )
        return self.params

    # ------------------------------------------------------------ serve

    def predict(self, features: np.ndarray) -> List[GameForecast]:
        if self._margin_coef is None or self._total_coef is None:
            raise RuntimeError("model is not fitted")
        X = np.atleast_2d(np.asarray(features, dtype=float))
        design = np.hstack([np.ones((len(X), 1)), X])
        exp_margin = design @ self._margin_coef
        exp_total = design @ self._total_coef
        return [
            self.forecast_from(float(m), float(t))
            for m, t in zip(exp_margin, exp_total)
        ]

    def forecast_from(self, exp_margin: float, exp_total: float) -> GameForecast:
        """Assemble a forecast from an expected margin and total.

        The one place a win probability is produced. Every consumer goes
        through here, which is what makes "the moneyline and the grid are
        the same number" true rather than aspirational.
        """
        sd = self.params.margin_sd
        p_home = 1.0 - _normal_cdf((CONTINUITY - exp_margin) / sd)
        p_home = min(max(p_home, 1e-6), 1 - 1e-6)
        forecast = GameForecast(
            p_home=p_home,
            p_away=1.0 - p_home,
            exp_margin=exp_margin,
            exp_total=exp_total,
            margin_sd=sd,
            total_sd=self.params.total_sd,
            exp_home_score=(exp_total + exp_margin) / 2.0,
            exp_away_score=(exp_total - exp_margin) / 2.0,
        )
        forecast.margin_total_corr = self.params.margin_total_corr  # type: ignore[attr-defined]
        return forecast

    def predict_from_elo(
        self,
        home_elo: float,
        away_elo: float,
        *,
        neutral: bool = False,
        home_advantage_elo: float = 100.0,
        points_per_elo: float = 28.0,
        exp_total: Optional[float] = None,
    ) -> GameForecast:
        """Forecast from ratings alone — the cold-start and baseline path."""
        edge = 0.0 if neutral else home_advantage_elo
        exp_margin = ((home_elo + edge) - away_elo) / points_per_elo
        return self.forecast_from(
            exp_margin,
            exp_total if exp_total is not None else self.params.total_intercept,
        )

    # ------------------------------------------------------------- io

    def save(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "params": self.params.as_dict(),
            "feature_names": self.feature_names,
            "margin_coef": (
                self._margin_coef.tolist() if self._margin_coef is not None else None
            ),
            "total_coef": (
                self._total_coef.tolist() if self._total_coef is not None else None
            ),
        }
        # temp-file + replace, so a crash mid-write leaves the previous valid
        # artifact serving rather than a truncated one.
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        tmp.replace(path)
        return path

    @classmethod
    def load(cls, path: Path) -> "MarginModel":
        payload = json.loads(Path(path).read_text())
        model = cls(MarginModelParams(**payload["params"]))
        model.feature_names = payload.get("feature_names") or []
        if payload.get("margin_coef"):
            model._margin_coef = np.asarray(payload["margin_coef"], dtype=float)
        if payload.get("total_coef"):
            model._total_coef = np.asarray(payload["total_coef"], dtype=float)
        return model


def _ridge_solve(design: np.ndarray, y: np.ndarray, ridge: float) -> np.ndarray:
    """Closed-form ridge, with the intercept left unpenalised.

    Penalising the intercept would shrink the league's average margin
    toward zero and quietly remove home advantage.
    """
    penalty = np.eye(design.shape[1]) * ridge
    penalty[0, 0] = 0.0
    return np.linalg.solve(design.T @ design + penalty, design.T @ y)


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
