"""Distance calculation and threshold decision for face templates."""

from __future__ import annotations

import math
import statistics
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


def median_distance(distances: Sequence[float]) -> float:
    """Return a validated median for odd or even distance collections."""

    if not distances:
        raise ValueError("At least one distance is required.")
    if any(not math.isfinite(distance) or distance < 0.0 for distance in distances):
        raise ValueError("Distances must be finite non-negative values.")
    return float(statistics.median(distances))


def median_enrollment_distance(
    live_representation: Sequence[float],
    enrollment_representations: Sequence[Sequence[float]],
) -> float:
    """Aggregate one live sample against every enrollment sample using median."""

    if not enrollment_representations:
        raise ValueError("At least one enrollment representation is required.")
    distances = [
        representation_distance(live_representation, enrollment_representation)
        for enrollment_representation in enrollment_representations
    ]
    return median_distance(distances)


def all_live_samples_match(distances: Sequence[float], threshold: float) -> bool:
    """Conservative consensus: every required live sample must pass."""

    if not distances:
        raise ValueError("At least one live-sample distance is required.")
    return all(is_match(distance, threshold) for distance in distances)
