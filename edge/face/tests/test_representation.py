from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy

from edge.face.diagnostics import EmbeddingDiagnostics, InferenceTimingDiagnostics
from edge.face.errors import EmbeddingError, ModelError
from edge.face.representation import SFaceEmbedder, validate_embedding


class FakeRecognizer:
    def __init__(self, embedding: numpy.ndarray) -> None:
        self.embedding = embedding
        self.alignment_detection: numpy.ndarray | None = None
        self.match_result = 0.75

    def alignCrop(
        self, _frame: numpy.ndarray, detection: numpy.ndarray
    ) -> numpy.ndarray:
        self.alignment_detection = detection
        return numpy.zeros((112, 112, 3), dtype=numpy.uint8)

    def feature(self, _aligned_face: numpy.ndarray) -> numpy.ndarray:
        return self.embedding

    def match(
        self, _first: numpy.ndarray, _second: numpy.ndarray, _metric: int
    ) -> float:
        return self.match_result


class FakeFactory:
    def __init__(self, recognizer: FakeRecognizer | None, *, fail: bool = False) -> None:
        self.recognizer = recognizer
        self.fail = fail
        self.calls: list[tuple[object, ...]] = []

    def create(self, *args: object) -> FakeRecognizer | None:
        self.calls.append(args)
        if self.fail:
            raise RuntimeError("invalid model")
        return self.recognizer


class FakeDnn:
    DNN_BACKEND_OPENCV = 3
    DNN_TARGET_CPU = 0


class FakeCv2:
    FaceRecognizerSF_FR_NORM_L2 = 1

    def __init__(
        self, recognizer: FakeRecognizer | None, *, fail: bool = False
    ) -> None:
        self.dnn = FakeDnn()
        self.FaceRecognizerSF = FakeFactory(recognizer, fail=fail)


class RepresentationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.model_path = Path(self.temporary_directory.name) / "sface.onnx"
        self.model_path.touch()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_missing_model_is_controlled(self) -> None:
        with self.assertRaisesRegex(ModelError, "SFace model is missing"):
            SFaceEmbedder(self.model_path.with_name("missing.onnx"))

    def test_model_load_error_is_controlled(self) -> None:
        with self.assertRaisesRegex(ModelError, "could not be loaded"):
            SFaceEmbedder(self.model_path, cv2_module=FakeCv2(None, fail=True))

    def test_valid_embedding_validation(self) -> None:
        diagnostics = validate_embedding(
            numpy.ones((1, 128), dtype=numpy.float32)
        )
        self.assertEqual(diagnostics.shape, (1, 128))
        self.assertEqual(diagnostics.dtype, "float32")
        self.assertTrue(diagnostics.all_finite)
        self.assertGreater(diagnostics.l2_norm, 0.0)

    def test_invalid_embedding_shapes_are_rejected(self) -> None:
        for embedding in (
            numpy.ones((128,), dtype=numpy.float32),
            numpy.ones((127,), dtype=numpy.float32),
            numpy.ones((2, 64), dtype=numpy.float32),
            numpy.ones((1, 1, 128), dtype=numpy.float32),
        ):
            with self.subTest(shape=embedding.shape):
                with self.assertRaises(EmbeddingError):
                    validate_embedding(embedding)

    def test_non_floating_non_finite_and_zero_embeddings_are_rejected(self) -> None:
        invalid_embeddings = (
            numpy.ones((1, 128), dtype=numpy.int32),
            numpy.full((1, 128), numpy.nan, dtype=numpy.float32),
            numpy.zeros((1, 128), dtype=numpy.float32),
        )
        for embedding in invalid_embeddings:
            with self.subTest(dtype=embedding.dtype):
                with self.assertRaises(EmbeddingError):
                    validate_embedding(embedding)

    def test_alignment_uses_complete_detection_and_emits_only_metadata(self) -> None:
        raw_embedding = numpy.full((1, 128), 7.123456, dtype=numpy.float32)
        recognizer = FakeRecognizer(raw_embedding)
        embedder = SFaceEmbedder(
            self.model_path, cv2_module=FakeCv2(recognizer)
        )
        detection = numpy.arange(15, dtype=numpy.float32)
        diagnostics: list[object] = []

        embedding = embedder.create_embedding(
            numpy.zeros((480, 640, 3), dtype=numpy.uint8),
            detection,
            diagnostic_sink=diagnostics.append,
        )

        self.assertEqual(len(embedding), 128)
        self.assertIs(recognizer.alignment_detection, detection)
        self.assertTrue(any(isinstance(event, EmbeddingDiagnostics) for event in diagnostics))
        self.assertEqual(
            sum(isinstance(event, InferenceTimingDiagnostics) for event in diagnostics),
            2,
        )
        self.assertFalse(any(isinstance(event, numpy.ndarray) for event in diagnostics))

    def test_distance_uses_opencv_sface_norm_l2(self) -> None:
        recognizer = FakeRecognizer(numpy.ones((1, 128), dtype=numpy.float32))
        fake_cv2 = FakeCv2(recognizer)
        embedder = SFaceEmbedder(self.model_path, cv2_module=fake_cv2)
        embedding = tuple(1.0 for _ in range(128))
        self.assertEqual(embedder.distance(embedding, embedding), 0.75)
        self.assertEqual(fake_cv2.FaceRecognizerSF.calls[0][-2:], (3, 0))


if __name__ == "__main__":
    unittest.main()
