from __future__ import annotations

import unittest

from edge.face.config import DEFAULT_SFACE_L2_DISTANCE_THRESHOLD
from edge.face.matching import (
    all_live_samples_match,
    is_match,
    median_distance,
    median_enrollment_distance,
    validate_l2_threshold,
)


def embedding(value: float) -> tuple[float, ...]:
    return (value,) + tuple(1.0 for _ in range(127))


def synthetic_distance(
    first: tuple[float, ...], second: tuple[float, ...]
) -> float:
    return abs(first[0] - second[0])


class MatchingTests(unittest.TestCase):
    def test_sface_l2_is_lower_is_better_and_boundary_is_inclusive(self) -> None:
        threshold = DEFAULT_SFACE_L2_DISTANCE_THRESHOLD
        self.assertTrue(is_match(threshold, threshold))
        self.assertFalse(is_match(threshold + 0.000001, threshold))

    def test_threshold_validation_is_sface_specific(self) -> None:
        self.assertEqual(validate_l2_threshold(1.128), 1.128)
        for invalid in (float("nan"), float("inf"), 0.0, -0.1, 2.0, 2.1):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    validate_l2_threshold(invalid)

    def test_median_distance_handles_odd_and_even_counts(self) -> None:
        self.assertEqual(median_distance([0.1, 0.4, 0.2]), 0.2)
        self.assertEqual(median_distance([0.1, 0.4, 0.2, 0.3]), 0.25)

    def test_median_enrollment_distance_uses_every_embedding_not_minimum(self) -> None:
        live = embedding(0.0)
        enrolled = (embedding(0.1), embedding(0.4), embedding(1.5))
        self.assertEqual(
            median_enrollment_distance(live, enrolled, synthetic_distance),
            0.4,
        )

    def test_live_consensus_requires_every_sample_to_pass(self) -> None:
        self.assertTrue(all_live_samples_match([0.8, 1.128, 0.9], 1.128))
        self.assertFalse(all_live_samples_match([0.8, 1.129, 0.9], 1.128))


if __name__ == "__main__":
    unittest.main()
