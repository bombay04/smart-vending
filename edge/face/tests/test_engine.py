from __future__ import annotations

import unittest
from unittest.mock import patch

from edge.face.config import (
    LBP_BIN_COUNT,
    LBP_GRID_COLUMNS,
    LBP_GRID_ROWS,
    MAX_ENROLLMENT_SAMPLE_COUNT,
    MIN_ENROLLMENT_SAMPLE_COUNT,
    REPRESENTATION_ALGORITHM,
)
from edge.face.engine import FaceEngine, validate_sample_count
from edge.face.errors import NoFaceError
from edge.face.models import FaceTemplate


def histogram_representation(primary: int) -> tuple[float, ...]:
    values: list[float] = []
    for _ in range(LBP_GRID_ROWS * LBP_GRID_COLUMNS):
        histogram = [0.0] * LBP_BIN_COUNT
        histogram[primary] = 1.0
        values.extend(histogram)
    return tuple(values)


class FakeTemplateStore:
    def __init__(self, template: FaceTemplate) -> None:
        self.template = template

    def load_all(self) -> list[FaceTemplate]:
        return [self.template]


class RecordingTemplateStore:
    def __init__(self) -> None:
        self.saved: FaceTemplate | None = None

    def save(self, template: FaceTemplate) -> None:
        self.saved = template


class PassthroughDetector:
    def extract_single_face(self, frame: object, **_kwargs: object) -> object:
        return frame


class NoFaceDetector:
    def extract_single_face(self, _frame: object, **_kwargs: object) -> object:
        raise NoFaceError("No usable face was detected.")


class RecognitionEngine(FaceEngine):
    def __init__(
        self, template: FaceTemplate, live: tuple[tuple[float, ...], ...]
    ) -> None:
        super().__init__(
            enrollment_sample_count=3,
            live_sample_count=3,
            template_store=FakeTemplateStore(template),  # type: ignore[arg-type]
            detector=object(),  # type: ignore[arg-type]
        )
        self.live = live

    def _collect_representations(
        self, *, phase: str, sample_count: int
    ) -> tuple[tuple[float, ...], ...]:
        self.assert_collection_request = (phase, sample_count)
        return self.live


class EngineConfigurationTests(unittest.TestCase):
    def test_enrollment_sample_count_validation(self) -> None:
        self.assertEqual(
            validate_sample_count(
                5,
                name="enrollment_sample_count",
                minimum=MIN_ENROLLMENT_SAMPLE_COUNT,
                maximum=MAX_ENROLLMENT_SAMPLE_COUNT,
            ),
            5,
        )
        for invalid in (2, 11, True):
            with self.assertRaises(ValueError):
                validate_sample_count(
                    invalid,
                    name="enrollment_sample_count",
                    minimum=MIN_ENROLLMENT_SAMPLE_COUNT,
                    maximum=MAX_ENROLLMENT_SAMPLE_COUNT,
                )

    def test_registration_collects_distinct_capture_results(self) -> None:
        store = RecordingTemplateStore()
        representations = tuple(histogram_representation(index) for index in range(3))
        engine = FaceEngine(
            enrollment_sample_count=3,
            template_store=store,  # type: ignore[arg-type]
            detector=PassthroughDetector(),  # type: ignore[arg-type]
        )
        with (
            patch("edge.face.engine.capture_frame", side_effect=["a", "b", "c"]) as capture,
            patch(
                "edge.face.engine.create_representation",
                side_effect=representations,
            ),
        ):
            template = engine.register("EMP001")

        self.assertEqual(capture.call_count, 3)
        self.assertEqual(template.representations, representations)
        self.assertIs(store.saved, template)

    def test_registration_face_retries_are_bounded(self) -> None:
        engine = FaceEngine(
            enrollment_sample_count=3,
            template_store=RecordingTemplateStore(),  # type: ignore[arg-type]
            detector=NoFaceDetector(),  # type: ignore[arg-type]
        )
        with patch("edge.face.engine.capture_frame", return_value="frame") as capture:
            with self.assertRaisesRegex(NoFaceError, "after 3 attempts"):
                engine.register("EMP001")
        self.assertEqual(capture.call_count, 3)


class RecognitionConsensusTests(unittest.TestCase):
    def setUp(self) -> None:
        enrolled = histogram_representation(0)
        self.template = FaceTemplate(
            employee_code="EMP001",
            algorithm=REPRESENTATION_ALGORITHM,
            representations=(enrolled, enrolled, enrolled),
        )

    def test_all_live_samples_pass_returns_match(self) -> None:
        live = histogram_representation(0)
        result = RecognitionEngine(self.template, (live, live, live)).recognize()
        self.assertTrue(result.matched)
        self.assertEqual(result.employee_code, "EMP001")
        self.assertEqual(result.sample_distances, (0.0, 0.0, 0.0))

    def test_any_live_sample_failure_returns_no_match(self) -> None:
        matching = histogram_representation(0)
        different = histogram_representation(2)
        result = RecognitionEngine(
            self.template, (matching, different, matching)
        ).recognize()
        self.assertFalse(result.matched)
        self.assertIsNone(result.employee_code)
        self.assertEqual(result.sample_distances, (0.0, 1.0, 0.0))


if __name__ == "__main__":
    unittest.main()
