"""SFace L2 aggregation and conservative threshold decisions."""

from __future__ import annotations

import math
import statistics
from collections.abc import Callable, Sequence

from .config import MAX_SFACE_L2_DISTANCE


DistanceFunction = Callable[[tuple[float, ...], tuple[float, ...]], float]


def validate_l2_threshold(threshold: float) -> float:
    if (
        not math.isfinite(threshold)
        or threshold <= 0.0
        or threshold >= MAX_SFACE_L2_DISTANCE
    ):
        raise ValueError(
            f"SFace L2 threshold must be finite and greater than 0.0 and less "
            f"than {MAX_SFACE_L2_DISTANCE}."
        )
    return threshold


def is_match(distance: float, threshold: float) -> bool:
    if (
        not math.isfinite(distance)
        or distance < 0.0
        or distance > MAX_SFACE_L2_DISTANCE + 1e-6
    ):
        raise ValueError("SFace L2 distance must be finite and between 0.0 and 2.0.")
    validate_l2_threshold(threshold)
    return distance <= threshold


def median_distance(distances: Sequence[float]) -> float:
    if not distances:
        raise ValueError("At least one distance is required.")
    if any(
        not math.isfinite(distance)
        or distance < 0.0
        or distance > MAX_SFACE_L2_DISTANCE + 1e-6
        for distance in distances
    ):
        raise ValueError("SFace L2 distances must be finite and valid.")
    return float(statistics.median(distances))


def median_enrollment_distance(
    live_embedding: tuple[float, ...],
    enrollment_embeddings: Sequence[tuple[float, ...]],
    distance_function: DistanceFunction,
) -> float:
    """Compare against every enrollment embedding and return the median L2 score."""

    if not enrollment_embeddings:
        raise ValueError("At least one enrollment embedding is required.")
    distances = [
        distance_function(live_embedding, enrollment_embedding)
        for enrollment_embedding in enrollment_embeddings
    ]
    return median_distance(distances)


def all_live_samples_match(distances: Sequence[float], threshold: float) -> bool:
    if not distances:
        raise ValueError("At least one live-sample distance is required.")
    return all(is_match(distance, threshold) for distance in distances)
