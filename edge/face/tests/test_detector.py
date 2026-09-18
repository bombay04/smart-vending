from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy

from edge.face.detector import YuNetFaceDetector
from edge.face.diagnostics import FaceDetectionDiagnostics
from edge.face.errors import ModelError, MultipleFacesError, NoFaceError


def valid_face(x: float = 10.0) -> numpy.ndarray:
    return numpy.array(
        [x, 20, 100, 120, 35, 55, 75, 55, 55, 80, 40, 105, 70, 105, 0.99],
        dtype=numpy.float32,
    )


class FakeNetwork:
    def __init__(self, faces: numpy.ndarray | None) -> None:
        self.faces = faces
        self.input_size: tuple[int, int] | None = None

    def setInputSize(self, input_size: tuple[int, int]) -> None:
        self.input_size = input_size

    def detect(self, _frame: numpy.ndarray) -> tuple[bool, numpy.ndarray | None]:
        return True, self.faces


class FakeFactory:
    def __init__(self, network: FakeNetwork | None, *, fail: bool = False) -> None:
        self.network = network
        self.fail = fail
        self.calls: list[tuple[object, ...]] = []

    def create(self, *args: object) -> FakeNetwork | None:
        self.calls.append(args)
        if self.fail:
            raise RuntimeError("invalid model")
        return self.network


class FakeDnn:
    DNN_BACKEND_OPENCV = 3
    DNN_TARGET_CPU = 0


class FakeCv2:
    def __init__(self, network: FakeNetwork | None, *, fail: bool = False) -> None:
        self.dnn = FakeDnn()
        self.FaceDetectorYN = FakeFactory(network, fail=fail)


class DetectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.model_path = Path(self.temporary_directory.name) / "yunet.onnx"
        self.model_path.touch()
        self.frame = numpy.zeros((200, 300, 3), dtype=numpy.uint8)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def detector(self, faces: numpy.ndarray | None) -> tuple[YuNetFaceDetector, FakeNetwork]:
        network = FakeNetwork(faces)
        return (
            YuNetFaceDetector(self.model_path, cv2_module=FakeCv2(network)),
            network,
        )

    def test_missing_model_is_controlled(self) -> None:
        with self.assertRaisesRegex(ModelError, "YuNet model is missing"):
            YuNetFaceDetector(self.model_path.with_name("missing.onnx"))

    def test_model_load_error_is_controlled(self) -> None:
        with self.assertRaisesRegex(ModelError, "could not be loaded"):
            YuNetFaceDetector(self.model_path, cv2_module=FakeCv2(None, fail=True))

    def test_no_face_is_not_silently_accepted(self) -> None:
        diagnostics: list[object] = []
        detector, _ = self.detector(None)
        with self.assertRaises(NoFaceError):
            detector.detect_single_face(
                self.frame, diagnostic_sink=diagnostics.append
            )
        detection = next(
            event for event in diagnostics if isinstance(event, FaceDetectionDiagnostics)
        )
        self.assertEqual(detection.bounding_boxes, ())

    def test_multiple_faces_are_not_silently_reduced_to_one(self) -> None:
        detector, _ = self.detector(numpy.stack((valid_face(), valid_face(130))))
        with self.assertRaises(MultipleFacesError):
            detector.detect_single_face(self.frame)

    def test_exactly_one_valid_face_returns_complete_yunet_row(self) -> None:
        network = FakeNetwork(numpy.stack((valid_face(),)))
        fake_cv2 = FakeCv2(network)
        detector = YuNetFaceDetector(self.model_path, cv2_module=fake_cv2)
        diagnostics: list[object] = []
        row = detector.detect_single_face(
            self.frame, diagnostic_sink=diagnostics.append
        )

        self.assertEqual(row.shape, (15,))
        self.assertEqual(network.input_size, (300, 200))
        self.assertEqual(fake_cv2.FaceDetectorYN.calls[0][-2:], (3, 0))
        detection = next(
            event for event in diagnostics if isinstance(event, FaceDetectionDiagnostics)
        )
        self.assertEqual(detection.bounding_boxes, ((10, 20, 100, 120),))
        self.assertTrue(detection.landmarks_valid[0])
        self.assertAlmostEqual(detection.confidences[0], 0.99, places=5)


if __name__ == "__main__":
    unittest.main()
