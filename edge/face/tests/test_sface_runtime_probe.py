from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy

from edge.face.sface_runtime_probe import (
    InvalidEmbeddingError,
    MissingModelError,
    MultipleProbeFacesError,
    NoProbeFaceError,
    format_probe_result,
    run_probe,
    select_exactly_one_face,
    validate_embedding,
)


class FakeDetector:
    def __init__(self) -> None:
        self.input_size: tuple[int, int] | None = None

    def setInputSize(self, input_size: tuple[int, int]) -> None:
        self.input_size = input_size

    def detect(self, _frame: numpy.ndarray) -> tuple[bool, numpy.ndarray]:
        faces = numpy.zeros((1, 15), dtype=numpy.float32)
        return True, faces


class FakeRecognizer:
    def __init__(self, embedding: numpy.ndarray) -> None:
        self.embedding = embedding

    def alignCrop(
        self, _frame: numpy.ndarray, _face: numpy.ndarray
    ) -> numpy.ndarray:
        return numpy.zeros((112, 112, 3), dtype=numpy.uint8)

    def feature(self, _aligned_face: numpy.ndarray) -> numpy.ndarray:
        return self.embedding


class FakeFactory:
    def __init__(self, instance: object) -> None:
        self.instance = instance
        self.calls: list[tuple[object, ...]] = []

    def create(self, *args: object) -> object:
        self.calls.append(args)
        return self.instance


class FakeDnn:
    DNN_BACKEND_OPENCV = 3
    DNN_TARGET_CPU = 0


class FakeCv2:
    def __init__(self, embedding: numpy.ndarray) -> None:
        self.dnn = FakeDnn()
        self.detector = FakeDetector()
        self.recognizer = FakeRecognizer(embedding)
        self.FaceDetectorYN = FakeFactory(self.detector)
        self.FaceRecognizerSF = FakeFactory(self.recognizer)


class SFaceRuntimeProbeTests(unittest.TestCase):
    def test_missing_models_fail_before_runtime_initialization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model_directory = Path(directory)
            with self.assertRaisesRegex(MissingModelError, "YuNet model is missing"):
                run_probe(
                    yunet_model=model_directory / "missing-yunet.onnx",
                    sface_model=model_directory / "missing-sface.onnx",
                )

            yunet_model = model_directory / "yunet.onnx"
            yunet_model.touch()
            with self.assertRaisesRegex(MissingModelError, "SFace model is missing"):
                run_probe(
                    yunet_model=yunet_model,
                    sface_model=model_directory / "missing-sface.onnx",
                )

    def test_embedding_validation_accepts_expected_finite_output(self) -> None:
        embedding = numpy.ones((1, 128), dtype=numpy.float32)
        diagnostics = validate_embedding(embedding)

        self.assertEqual(diagnostics.shape, (1, 128))
        self.assertEqual(diagnostics.dtype, "float32")
        self.assertTrue(diagnostics.all_finite)
        self.assertAlmostEqual(diagnostics.l2_norm, 128**0.5)

    def test_embedding_validation_rejects_non_finite_output(self) -> None:
        embedding = numpy.ones((1, 128), dtype=numpy.float32)
        embedding[0, 17] = numpy.nan

        with self.assertRaisesRegex(InvalidEmbeddingError, "non-finite"):
            validate_embedding(embedding)

    def test_exactly_one_face_gate(self) -> None:
        one_face = numpy.zeros((1, 15), dtype=numpy.float32)
        face, count = select_exactly_one_face((True, one_face))
        self.assertEqual(count, 1)
        self.assertEqual(face.shape, (15,))

        with self.assertRaises(NoProbeFaceError):
            select_exactly_one_face((True, None))
        with self.assertRaises(MultipleProbeFacesError):
            select_exactly_one_face(
                (True, numpy.zeros((2, 15), dtype=numpy.float32))
            )

    def test_probe_forces_cpu_backend_and_output_omits_embedding_values(self) -> None:
        embedding_value = 7.123456
        embedding = numpy.full((1, 128), embedding_value, dtype=numpy.float32)
        fake_cv2 = FakeCv2(embedding)
        frame = numpy.zeros((480, 640, 3), dtype=numpy.uint8)

        with tempfile.TemporaryDirectory() as directory:
            model_directory = Path(directory)
            yunet_model = model_directory / "yunet.onnx"
            sface_model = model_directory / "sface.onnx"
            yunet_model.touch()
            sface_model.touch()

            result = run_probe(
                yunet_model=yunet_model,
                sface_model=sface_model,
                cv2_module=fake_cv2,
                frame_capture=lambda *_args, **_kwargs: frame,
            )

        output = "\n".join(format_probe_result(result))
        self.assertIn("embeddingShape=1x128", output)
        self.assertIn("embeddingDtype=float32", output)
        self.assertIn("embeddingFinite=true", output)
        self.assertIn("yunetDetectionMs=", output)
        self.assertIn("sfaceFeatureMs=", output)
        self.assertNotIn(str(embedding_value), output)
        self.assertEqual(fake_cv2.FaceDetectorYN.calls[0][-2:], (3, 0))
        self.assertEqual(fake_cv2.FaceRecognizerSF.calls[0][-2:], (3, 0))


if __name__ == "__main__":
    unittest.main()
