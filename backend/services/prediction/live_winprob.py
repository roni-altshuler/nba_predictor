"""In-game win probability: what the score and the clock say.

**A different question from the rest of this project, and the first
forecaster here with a benchmark that is not the betting market.** The
pre-game model stops at tip-off; this one starts there. ESPN publishes its
own curve for every game, the site already renders it, and that curve is
therefore the baseline this has to beat to be worth serving — which is a
much fairer fight than the closing line, because ESPN's model reads exactly
the same three things this one does.

The shape
---------
A basketball game is a random walk with a drift, and the standing insight of
this project is that its increments are near-normal. So the natural
statement is a diffusion:

    remaining margin ~ Normal(drift * f, sigma * sqrt(f))

where `f` is the fraction of regulation left. The home side wins when the
current lead plus the remaining margin clears zero, so

    P(home) = Phi((lead + drift * f) / (sigma * sqrt(f)))

and the whole model is `lead / sqrt(f)` — a **standardised lead** — pushed
through a normal CDF. That is not an analogy to the pre-game model; it is
the same object. `margin_sd` there is this `sigma` at `f = 1`.

Rather than assume the closed form, the coefficients are fitted, which lets
the data say whether the sqrt law actually holds and absorbs the two effects
it cannot express: that leads are stickier than a pure random walk near the
end (teams protect them, and fouling makes the tail heavy), and that the
drift is not zero because the home side is better than even.

    logit P(home) = b0 + b1 * (lead / sqrt(f)) + b2 * lead + b3 * f

`b1` carries the diffusion. `b2` is the correction to the sqrt law. `b3` is
the home advantage decaying as the game runs out of time to express it.

Overtime
--------
`f` is zero at the buzzer and the standardised lead is undefined there, so
overtime cannot be a smaller `f` — it is a different regime. It gets its own
tiny model: a five-minute game starting level, where the only inputs are the
lead and the seconds left in the extra period. Folding it into the main fit
by clamping `f` to a small positive number is the obvious shortcut and it is
wrong: it would tell the model that a two-point lead in overtime is as
decisive as a two-point lead with four seconds left in regulation.

Fitting
-------
Newton-Raphson (IRLS), in numpy. **No sklearn**: the served model here is a
ridge fit in numpy on purpose, CI installs a bare Python, and a heavyweight
dependency for four coefficients would be the tail wagging the dog.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

REGULATION_SECONDS = 48 * 60
OVERTIME_SECONDS = 5 * 60

# The clock never truly reaches zero mid-play, and `lead / sqrt(f)` explodes
# as it approaches it. One second of floor keeps the transform finite without
# distorting anything a viewer would notice: at f = 1/2880 a one-point lead
# already standardises to 54, far into the flat tail of the logistic.
MIN_FRACTION = 1.0 / REGULATION_SECONDS

FEATURE_NAMES: Tuple[str, ...] = (
    "intercept",
    "lead_over_sqrt_f",   # the diffusion term: a standardised lead
    "lead",               # correction to the square-root law
    "fraction_left",      # home advantage, decaying as time runs out
)

OT_FEATURE_NAMES: Tuple[str, ...] = (
    "intercept",
    "lead_over_sqrt_f",
    "lead",
)


def fraction_left(seconds_remaining: float) -> float:
    """Share of REGULATION left, floored. Negative input means overtime."""
    return max(float(seconds_remaining) / REGULATION_SECONDS, MIN_FRACTION)


def _design(seconds: np.ndarray, lead: np.ndarray) -> np.ndarray:
    f = np.maximum(seconds / REGULATION_SECONDS, MIN_FRACTION)
    return np.column_stack([
        np.ones_like(f),
        lead / np.sqrt(f),
        lead,
        f,
    ])


def _design_ot(seconds: np.ndarray, lead: np.ndarray) -> np.ndarray:
    """Overtime, measured in the extra period rather than in regulation.

    `seconds` is negative here (the ingest counts down through regulation and
    keeps going), so the seconds left in the CURRENT overtime period are
    recovered modulo the period length.
    """
    elapsed_ot = -seconds
    left = OVERTIME_SECONDS - (elapsed_ot % OVERTIME_SECONDS)
    f = np.maximum(left / OVERTIME_SECONDS, 1.0 / OVERTIME_SECONDS)
    return np.column_stack([
        np.ones_like(f),
        lead / np.sqrt(f),
        lead,
    ])


def _sigmoid(z: np.ndarray) -> np.ndarray:
    # Clipped before exp: a standardised lead of 60 overflows float64 in the
    # naive form and silently produces nan coefficients.
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35.0, 35.0)))


def fit_logistic(
    X: np.ndarray, y: np.ndarray, *, ridge: float = 1e-6, iterations: int = 60
) -> np.ndarray:
    """IRLS with a whisper of ridge to keep the Hessian invertible.

    The ridge is not regularisation in any meaningful sense at 1e-6 — it is
    there because a perfectly separated slice (every game with a 40-point
    lead was won) drives a coefficient to infinity and the Hessian to
    singular, which is a real property of this data rather than a numerical
    accident.
    """
    n, k = X.shape
    beta = np.zeros(k)
    penalty = ridge * np.eye(k)
    penalty[0, 0] = 0.0  # never penalise the intercept
    for _ in range(iterations):
        p = _sigmoid(X @ beta)
        w = np.maximum(p * (1.0 - p), 1e-9)
        gradient = X.T @ (y - p) - ridge * beta
        hessian = (X * w[:, None]).T @ X + penalty
        try:
            step = np.linalg.solve(hessian, gradient)
        except np.linalg.LinAlgError:
            break
        beta = beta + step
        if np.max(np.abs(step)) < 1e-9:
            break
    return beta


@dataclass
class LiveWinProbModel:
    """Two fits: regulation, and overtime."""

    regulation: Optional[np.ndarray] = None
    overtime: Optional[np.ndarray] = None
    n_regulation: int = 0
    n_overtime: int = 0
    seasons: Tuple[int, ...] = ()

    def fit(
        self,
        seconds: np.ndarray,
        lead: np.ndarray,
        home_won: np.ndarray,
        *,
        seasons: Sequence[int] = (),
    ) -> "LiveWinProbModel":
        seconds = np.asarray(seconds, dtype=float)
        lead = np.asarray(lead, dtype=float)
        y = np.asarray(home_won, dtype=float)

        in_regulation = seconds > 0
        if in_regulation.sum():
            self.regulation = fit_logistic(
                _design(seconds[in_regulation], lead[in_regulation]),
                y[in_regulation],
            )
            self.n_regulation = int(in_regulation.sum())
        if (~in_regulation).sum():
            self.overtime = fit_logistic(
                _design_ot(seconds[~in_regulation], lead[~in_regulation]),
                y[~in_regulation],
            )
            self.n_overtime = int((~in_regulation).sum())
        self.seasons = tuple(sorted(set(int(s) for s in seasons)))
        return self

    def predict(self, seconds: np.ndarray, lead: np.ndarray) -> np.ndarray:
        """P(home wins) at each state. Vectorised over the whole game."""
        seconds = np.asarray(seconds, dtype=float)
        lead = np.asarray(lead, dtype=float)
        out = np.full(seconds.shape, 0.5, dtype=float)

        in_regulation = seconds > 0
        if self.regulation is not None and in_regulation.any():
            out[in_regulation] = _sigmoid(
                _design(seconds[in_regulation], lead[in_regulation])
                @ self.regulation
            )
        if self.overtime is not None and (~in_regulation).any():
            out[~in_regulation] = _sigmoid(
                _design_ot(seconds[~in_regulation], lead[~in_regulation])
                @ self.overtime
            )
        return out

    def as_dict(self) -> Dict:
        return {
            "regulation": {
                name: round(float(value), 6)
                for name, value in zip(FEATURE_NAMES, self.regulation)
            } if self.regulation is not None else None,
            "overtime": {
                name: round(float(value), 6)
                for name, value in zip(OT_FEATURE_NAMES, self.overtime)
            } if self.overtime is not None else None,
            "n_regulation": self.n_regulation,
            "n_overtime": self.n_overtime,
            "seasons": list(self.seasons),
            "features": list(FEATURE_NAMES),
        }


def tied_game_baseline(home_won: Sequence[bool]) -> float:
    """The only sensible dumb baseline: the home base rate, at every moment.

    A coin flip is the wrong yardstick for an in-game model because the home
    side wins about 55% of games before anything happens, and a forecaster
    that cannot beat "always say 55%" is not doing anything.
    """
    values = list(home_won)
    return sum(1 for v in values if v) / len(values) if values else 0.5
