"""Distance calculation and threshold decision for face templates."""

from __future__ import annotations

import math
from collections.abc import Sequence

from .config import LBP_GRID_COLUMNS, LBP_GRID_ROWS, REPRESENTATION_LENGTH


def representation_distance(
    first: Sequence[float], second: Sequence[float]
) -> float:
    """Return mean per-cell chi-square distance for two spatial histograms."""

    if len(first) != REPRESENTATION_LENGTH or len(second) != REPRESENTATION_LENGTH:
        raise ValueError(
            f"Representations must contain {REPRESENTATION_LENGTH} values."
        )

    distance = 0.0
    for first_value, second_value in zip(first, second, strict=True):
        if not math.isfinite(first_value) or not math.isfinite(second_value):
            raise ValueError("Representations must contain finite values.")
        if first_value < 0.0 or second_value < 0.0:
            raise ValueError("Histogram values cannot be negative.")
        denominator = first_value + second_value
        if denominator > 0.0:
            difference = first_value - second_value
            distance += 0.5 * difference * difference / denominator

    return distance / (LBP_GRID_ROWS * LBP_GRID_COLUMNS)


def is_match(distance: float, threshold: float) -> bool:
    if not math.isfinite(distance) or distance < 0.0:
        raise ValueError("Distance must be a finite non-negative value.")
    if not math.isfinite(threshold) or not 0.0 <= threshold <= 1.0:
        raise ValueError("Threshold must be a finite value from 0.0 to 1.0.")
    return distance <= threshold
