from __future__ import annotations

import unittest

import numpy

from edge.face.detector import HaarFaceDetector, normalized_square_bounds
from edge.face.diagnostics import FaceDetectionDiagnostics
from edge.face.errors import MultipleFacesError, NoFaceError


class FakeClassifier:
    def __init__(self, boxes: list[tuple[int, int, int, int]]) -> None:
        self.boxes = numpy.array(boxes, dtype=numpy.int32)

    def detectMultiScale(self, *_args: object, **_kwargs: object) -> numpy.ndarray:
        return self.boxes


def detector_with_boxes(boxes: list[tuple[int, int, int, int]]) -> HaarFaceDetector:
    detector = object.__new__(HaarFaceDetector)
    detector._classifier = FakeClassifier(boxes)
    return detector


class DetectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.frame = numpy.zeros((200, 300, 3), dtype=numpy.uint8)

    def test_no_face_is_not_silently_accepted(self) -> None:
        diagnostics: list[FaceDetectionDiagnostics] = []
        detector = detector_with_boxes([])
        with self.assertRaises(NoFaceError):
            detector.extract_single_face(
                self.frame, diagnostic_sink=diagnostics.append
            )
        self.assertEqual(len(diagnostics[0].bounding_boxes), 0)

    def test_multiple_faces_are_not_silently_reduced_to_one(self) -> None:
        diagnostics: list[FaceDetectionDiagnostics] = []
        detector = detector_with_boxes([(10, 10, 80, 80), (120, 20, 90, 90)])
        with self.assertRaises(MultipleFacesError):
            detector.extract_single_face(
                self.frame, diagnostic_sink=diagnostics.append
            )
        self.assertEqual(len(diagnostics[0].bounding_boxes), 2)

    def test_crop_is_square_and_does_not_stretch_haar_aspect_ratio(self) -> None:
        diagnostics: list[FaceDetectionDiagnostics] = []
        detector = detector_with_boxes([(50, 40, 100, 80)])
        crop = detector.extract_single_face(
            self.frame, diagnostic_sink=diagnostics.append
        )
        self.assertEqual(crop.shape, (72, 72))
        self.assertEqual(diagnostics[0].bounding_boxes, ((50, 40, 100, 80),))
        self.assertEqual(diagnostics[0].normalized_crop_box, (64, 44, 72, 72))
        self.assertEqual(
            (diagnostics[0].crop_width, diagnostics[0].crop_height), (72, 72)
        )

    def test_square_crop_stays_inside_frame_at_boundaries(self) -> None:
        for bounding_box in ((-10, -5, 50, 40), (280, 180, 50, 50)):
            x, y, width, height = normalized_square_bounds(
                bounding_box, frame_width=300, frame_height=200
            )
            self.assertEqual(width, height)
            self.assertGreaterEqual(x, 0)
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(x + width, 300)
            self.assertLessEqual(y + height, 200)


if __name__ == "__main__":
    unittest.main()
