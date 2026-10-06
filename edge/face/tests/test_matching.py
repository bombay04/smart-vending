from __future__ import annotations

import unittest

from edge.face.config import (
    DEFAULT_SFACE_L2_DISTANCE_THRESHOLD,
    SFACE_ALGORITHM,
    SFACE_MODEL_FILENAME,
    SFACE_SIMILARITY_METRIC,
    YUNET_MODEL_FILENAME,
)
from edge.face.matching import (
    all_live_samples_match,
    find_duplicate_employee_code,
    is_match,
    median_distance,
    median_enrollment_distance,
    validate_l2_threshold,
)
from edge.face.models import FaceTemplate


def embedding(value: float) -> tuple[float, ...]:
    return (value,) + tuple(1.0 for _ in range(127))


def synthetic_distance(
    first: tuple[float, ...], second: tuple[float, ...]
) -> float:
    return abs(first[0] - second[0])


def template(employee_code: str, values: tuple[float, ...]) -> FaceTemplate:
    return FaceTemplate(
        employee_code=employee_code,
        algorithm=SFACE_ALGORITHM,
        similarity_metric=SFACE_SIMILARITY_METRIC,
        detector_model=YUNET_MODEL_FILENAME,
        embedding_model=SFACE_MODEL_FILENAME,
        embeddings=tuple(embedding(value) for value in values),
    )


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

    def test_duplicate_comparison_uses_existing_consensus_and_threshold(self) -> None:
        existing = template("EMP001", (0.0, 0.1, 0.2))
        matching_candidate = tuple(embedding(value) for value in (0.1, 0.2, 0.3))
        one_failing_sample = tuple(embedding(value) for value in (0.1, 0.2, 0.8))

        self.assertEqual(
            find_duplicate_employee_code(
                matching_candidate,
                [existing],
                synthetic_distance,
                0.5,
                current_employee_code="EMP999",
            ),
            "EMP001",
        )
        self.assertIsNone(
            find_duplicate_employee_code(
                one_failing_sample,
                [existing],
                synthetic_distance,
                0.5,
                current_employee_code="EMP999",
            )
        )

    def test_duplicate_comparison_allows_empty_inventory_and_ignores_self(self) -> None:
        candidate = tuple(embedding(value) for value in (0.1, 0.2, 0.3))
        self.assertIsNone(
            find_duplicate_employee_code(
                candidate,
                [],
                synthetic_distance,
                0.5,
                current_employee_code="EMP001",
            )
        )
        self.assertIsNone(
            find_duplicate_employee_code(
                candidate,
                [template("EMP001", (0.1, 0.2, 0.3))],
                synthetic_distance,
                0.5,
                current_employee_code="EMP001",
            )
        )

    def test_duplicate_comparison_selects_closest_qualifying_employee(self) -> None:
        candidate = tuple(embedding(value) for value in (0.1, 0.2, 0.3))
        templates = [
            template("EMP002", (0.4, 0.5, 0.6)),
            template("EMP001", (0.1, 0.2, 0.3)),
            template("EMP003", (1.2, 1.3, 1.4)),
        ]
        self.assertEqual(
            find_duplicate_employee_code(
                candidate,
                templates,
                synthetic_distance,
                0.5,
                current_employee_code="EMP999",
            ),
            "EMP001",
        )


if __name__ == "__main__":
    unittest.main()
