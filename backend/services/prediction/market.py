"""Market mathematics: de-vigging, scoring rules, value and staking.

Ported from the sibling soccer project and reduced from three outcomes to
two. **That reduction is the single most consequential difference between
the two products and it cuts both ways.**

What gets easier: de-vigging a two-way market is tractable in closed form,
and near pick'em the method barely matters. **But "the two methods agree" is
false at the prices this league actually produces**, and the measurement is
worth stating rather than assuming:

| moneyline | Shin | proportional | difference |
|---|---|---|---|
| -110 / -110 | .5000 | .5000 | .0000 |
| -218 / +180 | .6642 | .6575 | .0067 |
| -400 / +320 | .7810 | .7706 | .0103 |
| -1000 / +650 | .8879 | .8721 | .0158 |

Agreement holds to ~.003 around even money and breaks down monotonically as
the favourite shortens. The NBA prices plenty of games at -400 and beyond,
so the choice of method moves the benchmark by more than the gap between two
decent models. `benchmark_market` therefore records which method produced a
number, and Shin is the default because the favourite–longshot bias it
corrects for is real.

What gets harder: **a binary market is much better calibrated, so the bar is
far higher.** Soccer's closing line reaches ~54% accuracy on 1X2 because a
quarter of matches are drawn. The NBA closing line lands its side about 70%
of the time and scores a binary Brier around .19. A soccer model that gets
within .02 Brier of the market is respectable; the same absolute gap here
would be a disaster. **Never compare a number from this project against a
number from the soccer one.** Different outcome spaces, different scales.

Conventions
-----------
* Probabilities are `(p_home, p_away)` and must sum to 1.
* American odds in, decimal odds derived. American is what ESPN publishes
  and converting on the way in would bake a convention into stored data.
* `brier_score` is the BINARY Brier — mean squared error on the home-win
  indicator, range [0, 1], lower is better. It is NOT the multiclass
  version the soccer project reports, and the two are not comparable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

Probabilities = Tuple[float, float]

# A book's overround on a two-way NBA moneyline sits around 4-5%. Anything
# outside this band is a parsing error, not a generous book: a booksum below
# 1 is an arbitrage that does not exist at scale, and above 1.25 means the
# two legs came from different games.
MIN_BOOKSUM = 0.90
MAX_BOOKSUM = 1.30


class MarketError(ValueError):
    """Base class for market input errors."""


class InvalidOddsError(MarketError):
    """Odds that cannot describe a real price."""


class ProbabilityError(MarketError):
    """A probability vector that is not one."""


# ------------------------------------------------------------------ odds


def american_to_decimal(american: float) -> float:
    """American moneyline → decimal odds.

    -218 → 1.4587 (risk 218 to win 100); +180 → 2.80.
    Zero is refused: it is not a price, and it is what an empty field
    coerces to.
    """
    value = float(american)
    if value == 0 or not math.isfinite(value):
        raise InvalidOddsError(f"{american!r} is not a moneyline")
    if value > 0:
        return 1.0 + value / 100.0
    return 1.0 + 100.0 / abs(value)


def decimal_to_american(decimal: float) -> float:
    value = float(decimal)
    if value <= 1.0 or not math.isfinite(value):
        raise InvalidOddsError(f"{decimal!r} is not decimal odds")
    if value >= 2.0:
        return (value - 1.0) * 100.0
    return -100.0 / (value - 1.0)


def validate_odds(value: object, *, name: str = "odds") -> float:
    if value is None:
        raise InvalidOddsError(f"{name} is missing")
    try:
        odds = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise InvalidOddsError(f"{name}={value!r} is not numeric") from exc
    if not math.isfinite(odds) or odds <= 1.0:
        raise InvalidOddsError(f"{name}={value!r} is not decimal odds > 1")
    return odds


def has_complete_odds(ml_home: object, ml_away: object) -> bool:
    """True when BOTH legs are present.

    One leg is not a market. De-vigging needs the booksum, and a lone
    favourite price silently read as a probability carries the full vig.
    """
    for value in (ml_home, ml_away):
        if value is None:
            return False
        try:
            if float(value) == 0:  # type: ignore[arg-type]
                return False
        except (TypeError, ValueError):
            return False
    return True


# ------------------------------------------------------------ de-vigging


def implied_probabilities(ml_home: float, ml_away: float) -> Probabilities:
    """Raw implied probabilities, vig included. They sum to > 1."""
    dh = american_to_decimal(ml_home)
    da = american_to_decimal(ml_away)
    return 1.0 / dh, 1.0 / da


def booksum(ml_home: float, ml_away: float) -> float:
    raw_home, raw_away = implied_probabilities(ml_home, ml_away)
    return raw_home + raw_away


def overround(ml_home: float, ml_away: float) -> float:
    return booksum(ml_home, ml_away) - 1.0


def devig_proportional(ml_home: float, ml_away: float) -> Probabilities:
    """Normalise the two raw probabilities to sum to 1."""
    raw_home, raw_away = implied_probabilities(ml_home, ml_away)
    total = raw_home + raw_away
    if not MIN_BOOKSUM <= total <= MAX_BOOKSUM:
        raise InvalidOddsError(
            f"booksum {total:.4f} outside [{MIN_BOOKSUM}, {MAX_BOOKSUM}] — "
            "these two legs are probably not the same game"
        )
    return raw_home / total, raw_away / total


def devig_shin(ml_home: float, ml_away: float) -> Probabilities:
    """Shin's method: remove the vig attributable to insider trading.

    For two outcomes Shin has a closed form, so there is no root-finding and
    no convergence to babysit. `z` is the estimated proportion of insider
    money; at z = 0 this reduces exactly to proportional de-vigging.
    """
    raw_home, raw_away = implied_probabilities(ml_home, ml_away)
    total = raw_home + raw_away
    if not MIN_BOOKSUM <= total <= MAX_BOOKSUM:
        raise InvalidOddsError(f"booksum {total:.4f} outside sane range")
    if total <= 1.0:
        return raw_home / total, raw_away / total

    # Guard the degenerate case where one leg is priced at ~certainty: the
    # square root below is real but the normalisation is numerically useless.
    pi_home = raw_home / total
    pi_away = raw_away / total
    if pi_home <= 0 or pi_away <= 0:
        return pi_home, pi_away

    z = _shin_z(raw_home, raw_away, total)
    out = []
    for raw in (raw_home, raw_away):
        value = (
            math.sqrt(z * z + 4.0 * (1.0 - z) * raw * raw / total) - z
        ) / (2.0 * (1.0 - z))
        out.append(value)
    norm = sum(out)
    return out[0] / norm, out[1] / norm


def _shin_z(raw_home: float, raw_away: float, total: float) -> float:
    """Estimated insider proportion, bisected on the normalisation residual."""
    if total <= 1.0:
        return 0.0

    def residual(z: float) -> float:
        if z >= 1.0:
            return float("inf")
        acc = 0.0
        for raw in (raw_home, raw_away):
            acc += (
                math.sqrt(z * z + 4.0 * (1.0 - z) * raw * raw / total) - z
            ) / (2.0 * (1.0 - z))
        return acc - 1.0

    lo, hi = 0.0, 0.9
    if residual(lo) * residual(hi) > 0:
        return 0.0
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if residual(lo) * residual(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0


def devig(ml_home: float, ml_away: float, method: str = "shin") -> Probabilities:
    if method == "proportional":
        return devig_proportional(ml_home, ml_away)
    if method == "shin":
        return devig_shin(ml_home, ml_away)
    raise ValueError(f"unknown de-vig method {method!r}")


def spread_to_probability(spread_home: float, sigma: float = 13.3) -> float:
    """Point spread → P(home wins), through the margin distribution.

    `spread_home` is negative when the home side is favoured, so the
    expected home margin is `-spread_home`. sigma is the measured standard
    deviation of NBA margins; see `margin_model.MARGIN_SD`.

    Useful where a book publishes a spread but no moneyline — common in the
    older `pickcenter` payloads.
    """
    return _normal_cdf(-float(spread_home) / sigma)


# --------------------------------------------------------- scoring rules


def _validate_probability(value: object, *, name: str) -> float:
    try:
        prob = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ProbabilityError(f"{name}={value!r} is not numeric") from exc
    if not math.isfinite(prob) or not 0.0 <= prob <= 1.0:
        raise ProbabilityError(f"{name}={value!r} is not in [0, 1]")
    return prob


def coerce_probabilities(p_home: object, p_away: Optional[object] = None,
                         *, tolerance: float = 1e-6) -> Probabilities:
    """Accept `(p_home,)` or `(p_home, p_away)` and return a normalised pair."""
    home = _validate_probability(p_home, name="p_home")
    if p_away is None:
        return home, 1.0 - home
    away = _validate_probability(p_away, name="p_away")
    total = home + away
    if abs(total - 1.0) > tolerance:
        if total <= 0:
            raise ProbabilityError("probabilities sum to zero")
        home, away = home / total, away / total
    return home, away


def brier_score(p_home: float, home_won: bool) -> float:
    """Binary Brier: squared error on the home-win indicator.

    Range [0, 1], lower is better. A coin flip scores .25. **Not comparable
    to the soccer project's multiclass Brier** — see the module docstring.
    """
    prob = _validate_probability(p_home, name="p_home")
    return (prob - (1.0 if home_won else 0.0)) ** 2


def log_loss_single(p_home: float, home_won: bool, *, eps: float = 1e-15) -> float:
    prob = min(max(_validate_probability(p_home, name="p_home"), eps), 1 - eps)
    return -math.log(prob if home_won else 1.0 - prob)


def accuracy(p_home: float, home_won: bool) -> float:
    """1 when the more likely side won. A .5 prediction scores .5, not 0 or 1."""
    prob = _validate_probability(p_home, name="p_home")
    if prob == 0.5:
        return 0.5
    return 1.0 if (prob > 0.5) == home_won else 0.0


# -------------------------------------------------------------- value/EV


def expected_value(model_prob: float, decimal_odds: float) -> float:
    """EV per unit staked. 0.05 means +5% expected return."""
    prob = _validate_probability(model_prob, name="model_prob")
    odds = validate_odds(decimal_odds, name="decimal_odds")
    return prob * (odds - 1.0) - (1.0 - prob)


def kelly_fraction(
    model_prob: float,
    decimal_odds: float,
    *,
    fraction: float = 0.25,
    cap: float = 0.05,
) -> float:
    """Fractional Kelly stake, capped, never negative.

    Defaults are quarter-Kelly capped at 5% of bankroll. Full Kelly is the
    growth-optimal stake only when the probability is exactly right, and a
    model that is 2 points overconfident at full Kelly is ruinous. The cap
    is the part that survives a model being wrong.
    """
    prob = _validate_probability(model_prob, name="model_prob")
    odds = validate_odds(decimal_odds, name="decimal_odds")
    b = odds - 1.0
    if b <= 0:
        return 0.0
    edge = prob * b - (1.0 - prob)
    if edge <= 0:
        return 0.0
    full = edge / b
    return max(0.0, min(full * fraction, cap))


def closing_line_value(
    taken_decimal: float, closing_decimal: float
) -> float:
    """Beat-the-close, as a proportion.

    Positive means the price taken was better than the close. Over a large
    sample CLV predicts profitability more reliably than realised results,
    because results carry the variance and CLV does not.
    """
    taken = validate_odds(taken_decimal, name="taken")
    closing = validate_odds(closing_decimal, name="closing")
    return taken / closing - 1.0


# ------------------------------------------------------------ calibration


@dataclass
class ReliabilityBucket:
    lower: float
    upper: float
    count: int
    mean_predicted: float
    observed: float

    def as_dict(self) -> Dict[str, float]:
        return {
            "lower": round(self.lower, 4),
            "upper": round(self.upper, 4),
            "count": self.count,
            "mean_predicted": round(self.mean_predicted, 4),
            "observed": round(self.observed, 4),
        }


def reliability_table(
    pairs: Sequence[Tuple[float, bool]], *, bins: int = 10
) -> List[ReliabilityBucket]:
    """Bucket (probability, outcome) pairs into a reliability curve.

    Empty buckets are omitted rather than emitted with observed = 0, which
    would draw a calibration curve diving to the floor in bands where
    nothing was predicted.
    """
    if not pairs:
        return []
    edges = [i / bins for i in range(bins + 1)]
    buckets: List[ReliabilityBucket] = []
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        if i == bins - 1:
            members = [(p, o) for p, o in pairs if lo <= p <= hi]
        else:
            members = [(p, o) for p, o in pairs if lo <= p < hi]
        if not members:
            continue
        buckets.append(
            ReliabilityBucket(
                lower=lo,
                upper=hi,
                count=len(members),
                mean_predicted=sum(p for p, _ in members) / len(members),
                observed=sum(1 for _, o in members if o) / len(members),
            )
        )
    return buckets


def expected_calibration_error(
    pairs: Sequence[Tuple[float, bool]], *, bins: int = 10
) -> float:
    """Sample-weighted mean gap between predicted and observed."""
    table = reliability_table(pairs, bins=bins)
    total = sum(b.count for b in table)
    if not total:
        return 0.0
    return sum(
        b.count * abs(b.mean_predicted - b.observed) for b in table
    ) / total


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _normal_ppf(p: float) -> float:
    """Inverse normal CDF, by bisection on `_normal_cdf`.

    Bisection rather than a rational approximation because this is called
    once per interval level — three times per benchmark, not once per game —
    and a closed-form approximation would be a second place for a numerical
    bug to live for the sake of microseconds nobody is waiting on.
    """
    if not 0.0 < p < 1.0:
        raise ValueError(f"{p!r} is not a probability strictly inside (0, 1)")
    lo, hi = -12.0, 12.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if _normal_cdf(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# ------------------------------------------------- continuous forecasts
#
# Margin and total are PUBLISHED on every game card and were, for the whole
# life of this project, scored nowhere. The standing rule is that an accuracy
# claim is stated as a paired measurement on named games or it is not stated,
# and an expected total printed beside a win probability is exactly such a
# claim. Everything below exists to make those two numbers falsifiable on the
# same footing as the moneyline.
#
# The interval work is the part that matters most. `margin_sd` is not
# decoration: the win probability, the score grid and every series price are
# all read off the same fitted normal, so if its stated spread is too narrow
# then every probability downstream is overconfident by a knowable amount.
# CLAUDE.md justifies the normal on the UNCONDITIONAL margin distribution
# (skew -0.019, excess kurtosis +0.304). That is not the same claim: what has
# to hold is that the FORECAST residual, standardised by the sd the model
# published for that specific game, is standard normal. Coverage and the PIT
# histogram test that directly.


def signed_errors(
    pairs: Sequence[Tuple[float, float]]
) -> List[float]:
    """`predicted - actual` for each pair. Sign kept: bias is a finding."""
    return [float(p) - float(a) for p, a in pairs]


def summarise_continuous(
    pairs: Sequence[Tuple[float, float]]
) -> Dict[str, float]:
    """MAE, RMSE and bias for (predicted, actual) pairs.

    Bias is reported separately from MAE and is the more diagnostic of the
    two: a forecaster that is 3 points long on every total has an MAE that
    looks like noise and a bias that names the bug.
    """
    if not pairs:
        return {"n": 0}
    errors = signed_errors(pairs)
    n = len(errors)
    absolute = sorted(abs(e) for e in errors)
    mid = n // 2
    median = (
        absolute[mid] if n % 2 else (absolute[mid - 1] + absolute[mid]) / 2.0
    )
    return {
        "n": n,
        "mae": sum(absolute) / n,
        "rmse": math.sqrt(sum(e * e for e in errors) / n),
        "bias": sum(errors) / n,
        "median_ae": median,
        "mean_actual": sum(float(a) for _, a in pairs) / n,
        "mean_predicted": sum(float(p) for p, _ in pairs) / n,
    }


def pit_values(
    triples: Sequence[Tuple[float, float, float]]
) -> List[float]:
    """Probability integral transform of (predicted, actual, sd) triples.

    `PIT = Φ((actual - predicted) / sd)`. If the published distribution is
    right, these are uniform on [0, 1] — that is the whole test, and it is
    strictly stronger than any single coverage number because it catches the
    shape as well as the width.

    A non-positive sd is dropped rather than clamped. It means the model
    published a point forecast as a distribution, which is a bug to find,
    not a value to repair on the way past.
    """
    out: List[float] = []
    for predicted, actual, sd in triples:
        spread = float(sd)
        if not math.isfinite(spread) or spread <= 0:
            continue
        out.append(_normal_cdf((float(actual) - float(predicted)) / spread))
    return out


def interval_coverage(
    triples: Sequence[Tuple[float, float, float]],
    levels: Sequence[float] = (0.5, 0.8, 0.95),
) -> List[Dict[str, float]]:
    """Realised coverage of central prediction intervals.

    For each nominal level, the share of actual outcomes that fell inside the
    model's own interval. Under-coverage means the published sd is too
    narrow, and every probability derived from it is overconfident in the
    same direction.
    """
    usable = [
        (float(p), float(a), float(s))
        for p, a, s in triples
        if math.isfinite(float(s)) and float(s) > 0
    ]
    out: List[Dict[str, float]] = []
    for level in levels:
        z = _normal_ppf(0.5 + level / 2.0)
        inside = sum(
            1 for p, a, s in usable if abs(a - p) <= z * s
        )
        n = len(usable)
        out.append(
            {
                "nominal": round(level, 4),
                "n": n,
                "covered": inside,
                "coverage": round(inside / n, 4) if n else 0.0,
                "gap": round(inside / n - level, 4) if n else 0.0,
                "half_width_z": round(z, 4),
            }
        )
    return out


def pit_histogram(values: Sequence[float], *, bins: int = 10) -> List[Dict[str, float]]:
    """Bucketed PIT values, with the uniform expectation beside each bar.

    Emitted with `expected` on every row so the chart never has to know how
    many bins produced it, and an empty bin is emitted as zero rather than
    omitted — unlike the reliability table, where an empty bin means "nothing
    was predicted there" and here it means "nothing landed there", which is a
    finding.
    """
    if not values:
        return []
    counts = [0] * bins
    for value in values:
        index = min(int(value * bins), bins - 1)
        counts[index] += 1
    total = len(values)
    return [
        {
            "lower": round(i / bins, 4),
            "upper": round((i + 1) / bins, 4),
            "count": counts[i],
            "share": round(counts[i] / total, 4),
            "expected": round(1.0 / bins, 4),
        }
        for i in range(bins)
    ]


def pit_uniformity(values: Sequence[float], *, bins: int = 10) -> Dict[str, float]:
    """A chi-square statistic on the PIT histogram against uniform.

    Reported as a statistic and its degrees of freedom, deliberately without
    a p-value. At n in the tens of thousands any real model fails a
    goodness-of-fit test on some decimal place, and printing `p < .001`
    beside a histogram that is visibly close to flat would be technically
    true and completely misleading. The statistic per degree of freedom is
    the number worth reading.
    """
    table = pit_histogram(values, bins=bins)
    if not table:
        return {"n": 0}
    total = len(values)
    expected = total / bins
    chi2 = sum((row["count"] - expected) ** 2 / expected for row in table)
    return {
        "n": total,
        "bins": bins,
        "chi_square": round(chi2, 3),
        "dof": bins - 1,
        "chi_square_per_dof": round(chi2 / (bins - 1), 3),
        "max_abs_deviation": round(
            max(abs(row["share"] - row["expected"]) for row in table), 4
        ),
    }


def summarise(
    pairs: Sequence[Tuple[float, bool]]
) -> Dict[str, float]:
    """Headline scores for a set of (p_home, home_won) pairs."""
    if not pairs:
        return {"n": 0}
    n = len(pairs)
    return {
        "n": n,
        "brier": sum(brier_score(p, o) for p, o in pairs) / n,
        "log_loss": sum(log_loss_single(p, o) for p, o in pairs) / n,
        "accuracy": sum(accuracy(p, o) for p, o in pairs) / n,
        "ece": expected_calibration_error(pairs),
        "mean_predicted": sum(p for p, _ in pairs) / n,
        "base_rate": sum(1 for _, o in pairs if o) / n,
    }
