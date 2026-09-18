from __future__ import annotations

import unittest

from edge.face.config import (
    DEFAULT_MATCH_DISTANCE_THRESHOLD,
    LBP_BIN_COUNT,
    LBP_GRID_COLUMNS,
    LBP_GRID_ROWS,
)
from edge.face.matching import is_match, representation_distance


def histogram_representation(primary: int, secondary_weight: float = 0.0) -> tuple[float, ...]:
    values: list[float] = []
    for _ in range(LBP_GRID_ROWS * LBP_GRID_COLUMNS):
        histogram = [0.0] * LBP_BIN_COUNT
        histogram[primary] = 1.0 - secondary_weight
        histogram[(primary + 1) % LBP_BIN_COUNT] = secondary_weight
        values.extend(histogram)
    return tuple(values)


class MatchingTests(unittest.TestCase):
    def test_same_representation_matches(self) -> None:
        representation = histogram_representation(0)
        distance = representation_distance(representation, representation)
        self.assertEqual(distance, 0.0)
        self.assertTrue(is_match(distance, DEFAULT_MATCH_DISTANCE_THRESHOLD))

    def test_similar_representation_matches(self) -> None:
        registered = histogram_representation(0)
        similar = histogram_representation(0, secondary_weight=0.10)
        distance = representation_distance(registered, similar)
        self.assertLess(distance, DEFAULT_MATCH_DISTANCE_THRESHOLD)
        self.assertTrue(is_match(distance, DEFAULT_MATCH_DISTANCE_THRESHOLD))

    def test_different_representation_does_not_match(self) -> None:
        first = histogram_representation(0)
        second = histogram_representation(2)
        distance = representation_distance(first, second)
        self.assertGreater(distance, DEFAULT_MATCH_DISTANCE_THRESHOLD)
        self.assertFalse(is_match(distance, DEFAULT_MATCH_DISTANCE_THRESHOLD))

    def test_threshold_is_inclusive_at_boundary(self) -> None:
        self.assertTrue(is_match(0.35, 0.35))
        self.assertFalse(is_match(0.350001, 0.35))

    def test_invalid_threshold_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            is_match(0.1, float("nan"))
        with self.assertRaises(ValueError):
            is_match(0.1, 1.01)


if __name__ == "__main__":
    unittest.main()
