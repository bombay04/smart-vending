from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy

from edge.face.camera import capture_frame
from edge.face.diagnostics import CameraCaptureDiagnostics
from edge.face.errors import CameraError


class FakeCapture:
    def __init__(self, frames: list[numpy.ndarray]) -> None:
        self.frames = frames
        self.read_calls = 0
        self.released = False

    def isOpened(self) -> bool:
        return True

    def set(self, _property: int, _value: int) -> bool:
        return True

    def read(self) -> tuple[bool, numpy.ndarray | None]:
        self.read_calls += 1
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)

    def release(self) -> None:
        self.released = True


class FakeCv2:
    CAP_PROP_FRAME_WIDTH = 1
    CAP_PROP_FRAME_HEIGHT = 2
    CAP_PROP_BUFFERSIZE = 3

    def __init__(self, capture: FakeCapture) -> None:
        self.capture = capture

    def VideoCapture(self, _camera_index: int) -> FakeCapture:
        return self.capture


class CameraTests(unittest.TestCase):
    def test_stabilization_discards_frames_then_reads_a_fresh_frame(self) -> None:
        frames = [numpy.full((10, 20, 3), value, dtype=numpy.uint8) for value in range(4)]
        fake_capture = FakeCapture(frames)
        diagnostics: list[CameraCaptureDiagnostics] = []

        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            patch(
                "edge.face.camera.time.monotonic",
                side_effect=[0.0, 0.0, 0.4, 0.8, 1.1, 1.1],
            ),
        ):
            frame = capture_frame(
                4,
                stabilization_seconds=1.0,
                diagnostic_sink=diagnostics.append,
            )

        self.assertEqual(fake_capture.read_calls, 4)
        self.assertTrue(fake_capture.released)
        self.assertTrue(numpy.all(frame == 3))
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0].stabilization_reads, 3)
        self.assertEqual(diagnostics[0].successful_discarded_frames, 3)
        self.assertEqual(diagnostics[0].post_stabilization_attempts, 1)
        self.assertEqual(
            (diagnostics[0].frame_width, diagnostics[0].frame_height), (20, 10)
        )

    def test_stabilization_frame_reads_are_bounded(self) -> None:
        frames = [numpy.zeros((10, 20, 3), dtype=numpy.uint8) for _ in range(10)]
        fake_capture = FakeCapture(frames)
        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            patch("edge.face.camera.time.monotonic", return_value=0.0),
        ):
            with self.assertRaises(CameraError):
                capture_frame(
                    0,
                    stabilization_seconds=1.0,
                    max_stabilization_reads=3,
                )
        self.assertEqual(fake_capture.read_calls, 3)
        self.assertTrue(fake_capture.released)

    def test_missing_fresh_frame_returns_camera_error_after_bounded_attempts(self) -> None:
        fake_capture = FakeCapture([])
        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            patch("edge.face.camera.time.monotonic", side_effect=[0.0, 0.0, 0.0]),
        ):
            with self.assertRaises(CameraError):
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=2,
                )
        self.assertEqual(fake_capture.read_calls, 2)
        self.assertTrue(fake_capture.released)


if __name__ == "__main__":
    unittest.main()
