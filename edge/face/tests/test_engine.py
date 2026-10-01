from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from edge.face.config import (
    MAX_ENROLLMENT_SAMPLE_COUNT,
    MIN_ENROLLMENT_SAMPLE_COUNT,
    SFACE_ALGORITHM,
    SFACE_MODEL_FILENAME,
    SFACE_SIMILARITY_METRIC,
    YUNET_MODEL_FILENAME,
)
from edge.face.diagnostics import ConsensusDecisionDiagnostics
from edge.face.engine import FaceEngine, validate_sample_count
from edge.face.errors import AlreadyRegisteredError, CameraError, NoFaceError
from edge.face.models import FaceTemplate
from edge.face.storage import TemplateStore


def embedding(value: float) -> tuple[float, ...]:
    return (value,) + tuple(1.0 for _ in range(127))


def template(employee_code: str, values: tuple[float, ...]) -> FaceTemplate:
    return FaceTemplate(
        employee_code=employee_code,
        algorithm=SFACE_ALGORITHM,
        similarity_metric=SFACE_SIMILARITY_METRIC,
        detector_model=YUNET_MODEL_FILENAME,
        embedding_model=SFACE_MODEL_FILENAME,
        embeddings=tuple(embedding(value) for value in values),
    )


class FakeTemplateStore:
    def __init__(self, templates: list[FaceTemplate]) -> None:
        self.templates = templates

    def load_all(self) -> list[FaceTemplate]:
        return self.templates


class RecordingTemplateStore:
    def __init__(self, *, exists: bool = False) -> None:
        self.saved: FaceTemplate | None = None
        self.template_exists = exists

    def exists(self, _employee_code: str) -> bool:
        return self.template_exists

    def save(self, face_template: FaceTemplate) -> None:
        self.saved = face_template


class PassthroughDetector:
    def detect_single_face(self, frame: object, **_kwargs: object) -> object:
        return frame


class RecordingDetector(PassthroughDetector):
    def __init__(self) -> None:
        self.frames: list[object] = []

    def detect_single_face(self, frame: object, **_kwargs: object) -> object:
        self.frames.append(frame)
        return frame


class NoFaceDetector:
    def detect_single_face(self, _frame: object, **_kwargs: object) -> object:
        raise NoFaceError("No usable face was detected.")


class FakeEmbedder:
    def __init__(self, embeddings: tuple[tuple[float, ...], ...] = ()) -> None:
        self.embeddings = iter(embeddings)

    def create_embedding(self, *_args: object, **_kwargs: object) -> tuple[float, ...]:
        return next(self.embeddings)

    def distance(
        self, first: tuple[float, ...], second: tuple[float, ...]
    ) -> float:
        return abs(first[0] - second[0])


class FakeCameraSession:
    def __init__(self, frames: list[object]) -> None:
        self.frames = iter(frames)
        self.capture_calls = 0
        self.enter_calls = 0
        self.exit_calls = 0

    def __enter__(self) -> FakeCameraSession:
        self.enter_calls += 1
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.exit_calls += 1

    def capture_frame(self) -> object:
        self.capture_calls += 1
        return next(self.frames)


class FailingCameraSession:
    def __init__(self, reason: str = "BLACK_FRAME") -> None:
        self.reason = reason

    def __enter__(self) -> FailingCameraSession:
        raise CameraError("unhealthy stream", reason=self.reason)

    def __exit__(self, *_exc_info: object) -> None:
        pass


class RecognitionEngine(FaceEngine):
    def __init__(
        self,
        templates: list[FaceTemplate],
        live: tuple[tuple[float, ...], ...],
        *,
        diagnostic_sink: object | None = None,
    ) -> None:
        super().__init__(
            sface_l2_threshold=0.5,
            enrollment_sample_count=3,
            live_sample_count=3,
            template_store=FakeTemplateStore(templates),  # type: ignore[arg-type]
            detector=PassthroughDetector(),  # type: ignore[arg-type]
            embedder=FakeEmbedder(),  # type: ignore[arg-type]
            diagnostic_sink=diagnostic_sink,  # type: ignore[arg-type]
        )
        self.live = live

    def _collect_embeddings(
        self, *, phase: str, sample_count: int
    ) -> tuple[tuple[float, ...], ...]:
        self.collection_request = (phase, sample_count)
        return self.live


class ScriptedCollectionEngine(FaceEngine):
    def __init__(
        self,
        template_store: TemplateStore,
        collections: list[tuple[tuple[float, ...], ...]],
    ) -> None:
        super().__init__(
            sface_l2_threshold=0.5,
            template_store=template_store,
            detector=PassthroughDetector(),  # type: ignore[arg-type]
            embedder=FakeEmbedder(),  # type: ignore[arg-type]
        )
        self.collections = iter(collections)

    def _collect_embeddings(
        self, *, phase: str, sample_count: int
    ) -> tuple[tuple[float, ...], ...]:
        collection = next(self.collections)
        self.collection_request = (phase, sample_count)
        return collection


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

    def test_registration_collects_and_retains_distinct_embeddings(self) -> None:
        store = RecordingTemplateStore()
        embeddings = tuple(embedding(value) for value in (0.1, 0.2, 0.3, 0.4, 0.5))
        engine = FaceEngine(
            template_store=store,  # type: ignore[arg-type]
            detector=PassthroughDetector(),  # type: ignore[arg-type]
            embedder=FakeEmbedder(embeddings),  # type: ignore[arg-type]
        )
        camera = FakeCameraSession(["a", "b", "c", "d", "e"])
        with patch("edge.face.engine.CameraCaptureSession", return_value=camera) as factory:
            registered = engine.register("EMP001")

        factory.assert_called_once_with(
            0, stabilization_seconds=1.5, diagnostic_sink=None
        )
        self.assertEqual(camera.capture_calls, 5)
        self.assertEqual((camera.enter_calls, camera.exit_calls), (1, 1))
        self.assertEqual(registered.embeddings, embeddings)
        self.assertEqual(registered.similarity_metric, SFACE_SIMILARITY_METRIC)
        self.assertIs(store.saved, registered)

    def test_healthy_camera_capture_reaches_existing_detection_pipeline(self) -> None:
        store = RecordingTemplateStore()
        detector = RecordingDetector()
        captured_frame = object()
        embeddings = tuple(embedding(value) for value in (0.1, 0.2, 0.3))
        engine = FaceEngine(
            enrollment_sample_count=3,
            template_store=store,  # type: ignore[arg-type]
            detector=detector,  # type: ignore[arg-type]
            embedder=FakeEmbedder(embeddings),  # type: ignore[arg-type]
        )

        camera = FakeCameraSession([captured_frame] * 3)
        with patch("edge.face.engine.CameraCaptureSession", return_value=camera):
            registered = engine.register("EMP001")

        self.assertEqual(detector.frames, [captured_frame] * 3)
        self.assertEqual(registered.embeddings, embeddings)

    def test_existing_template_is_rejected_before_camera_capture(self) -> None:
        store = RecordingTemplateStore(exists=True)
        engine = FaceEngine(
            template_store=store,  # type: ignore[arg-type]
            detector=PassthroughDetector(),  # type: ignore[arg-type]
            embedder=FakeEmbedder(),  # type: ignore[arg-type]
        )

        with patch("edge.face.engine.CameraCaptureSession") as session_factory:
            with self.assertRaises(AlreadyRegisteredError):
                engine.register("EMP001")

        session_factory.assert_not_called()
        self.assertIsNone(store.saved)

    def test_failed_registration_does_not_replace_existing_template(self) -> None:
        store = RecordingTemplateStore()
        engine = FaceEngine(
            enrollment_sample_count=3,
            template_store=store,  # type: ignore[arg-type]
            detector=NoFaceDetector(),  # type: ignore[arg-type]
            embedder=FakeEmbedder(),  # type: ignore[arg-type]
        )
        camera = FakeCameraSession(["frame"] * 3)
        with patch("edge.face.engine.CameraCaptureSession", return_value=camera):
            with self.assertRaisesRegex(NoFaceError, "after 3 attempts"):
                engine.register("EMP001")
        self.assertEqual(camera.capture_calls, 3)
        self.assertEqual(camera.exit_calls, 1)
        self.assertIsNone(store.saved)

    def test_recognition_collects_all_live_samples_in_one_camera_session(self) -> None:
        employee = template("EMP001", (0.0, 0.1, 0.2))
        live = tuple(embedding(value) for value in (0.1, 0.2, 0.3))
        engine = FaceEngine(
            sface_l2_threshold=0.5,
            template_store=FakeTemplateStore([employee]),  # type: ignore[arg-type]
            detector=PassthroughDetector(),  # type: ignore[arg-type]
            embedder=FakeEmbedder(live),  # type: ignore[arg-type]
        )
        camera = FakeCameraSession(["a", "b", "c"])

        with patch("edge.face.engine.CameraCaptureSession", return_value=camera) as factory:
            result = engine.recognize()

        self.assertTrue(result.matched)
        self.assertEqual(camera.capture_calls, 3)
        self.assertEqual((camera.enter_calls, camera.exit_calls), (1, 1))
        factory.assert_called_once()

    def test_unhealthy_camera_failure_never_reaches_detector_as_no_face(self) -> None:
        for reason in ("BLACK_FRAME", "NEAR_BLACK_FRAME"):
            with self.subTest(reason=reason):
                store = RecordingTemplateStore()
                detector = RecordingDetector()
                engine = FaceEngine(
                    enrollment_sample_count=3,
                    template_store=store,  # type: ignore[arg-type]
                    detector=detector,  # type: ignore[arg-type]
                    embedder=FakeEmbedder(),  # type: ignore[arg-type]
                )

                with patch(
                    "edge.face.engine.CameraCaptureSession",
                    return_value=FailingCameraSession(reason),
                ):
                    with self.assertRaises(CameraError) as raised:
                        engine.register("EMP001")

                self.assertEqual(raised.exception.reason, reason)
                self.assertEqual(detector.frames, [])
                self.assertIsNone(store.saved)

    def test_registered_template_is_used_by_existing_recognition_path(self) -> None:
        enrollment = tuple(
            embedding(value) for value in (0.1, 0.2, 0.3, 0.4, 0.5)
        )
        live = tuple(embedding(value) for value in (0.1, 0.2, 0.3))
        with tempfile.TemporaryDirectory() as directory:
            store = TemplateStore(Path(directory))
            engine = ScriptedCollectionEngine(store, [enrollment, live])

            engine.register("EMP001")
            result = engine.recognize()

        self.assertTrue(result.matched)
        self.assertEqual(result.employee_code, "EMP001")


class RecognitionConsensusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.employee = template("EMP001", (0.0, 0.1, 0.2))

    def test_all_live_samples_pass_returns_match(self) -> None:
        live = (embedding(0.1), embedding(0.2), embedding(0.3))
        result = RecognitionEngine([self.employee], live).recognize()
        self.assertTrue(result.matched)
        self.assertEqual(result.employee_code, "EMP001")
        for actual, expected in zip(
            result.sample_distances, (0.1, 0.1, 0.2), strict=True
        ):
            self.assertAlmostEqual(actual, expected)

    def test_any_live_sample_failure_returns_no_match(self) -> None:
        live = (embedding(0.1), embedding(1.0), embedding(0.2))
        result = RecognitionEngine([self.employee], live).recognize()
        self.assertFalse(result.matched)
        self.assertIsNone(result.employee_code)
        for actual, expected in zip(
            result.sample_distances, (0.1, 0.9, 0.1), strict=True
        ):
            self.assertAlmostEqual(actual, expected)

    def test_multiple_qualifying_employees_are_rejected_as_ambiguous(self) -> None:
        diagnostics: list[object] = []
        second = template("EMP002", (0.1, 0.2, 0.3))
        live = (embedding(0.15), embedding(0.2), embedding(0.25))
        result = RecognitionEngine(
            [self.employee, second], live, diagnostic_sink=diagnostics.append
        ).recognize()

        self.assertFalse(result.matched)
        self.assertIsNone(result.employee_code)
        consensus = next(
            event
            for event in diagnostics
            if isinstance(event, ConsensusDecisionDiagnostics)
        )
        self.assertEqual(consensus.reason, "ambiguous_candidates")


if __name__ == "__main__":
    unittest.main()
