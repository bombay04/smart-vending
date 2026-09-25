from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy

from edge.face.camera import capture_frame, frame_health_reason
from edge.face.diagnostics import CameraCaptureDiagnostics
from edge.face.errors import CameraError


def healthy_frame(value: int = 120) -> numpy.ndarray:
    return numpy.full((48, 64, 3), value, dtype=numpy.uint8)


class FakeCapture:
    def __init__(
        self,
        frames: list[numpy.ndarray] | None = None,
        *,
        opened: bool = True,
    ) -> None:
        self.frames = list(frames or [])
        self.opened = opened
        self.read_calls = 0
        self.released = False

    def isOpened(self) -> bool:
        return self.opened

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
    CAP_PROP_READ_TIMEOUT_MSEC = 4

    def __init__(self, captures: FakeCapture | list[FakeCapture]) -> None:
        self.captures = list(captures) if isinstance(captures, list) else [captures]
        self.open_calls = 0

    def VideoCapture(self, _camera_index: int) -> FakeCapture:
        capture = self.captures[self.open_calls]
        self.open_calls += 1
        return capture


class CameraTests(unittest.TestCase):
    def test_stabilization_discards_frames_then_reads_a_healthy_fresh_frame(
        self,
    ) -> None:
        frames = [healthy_frame(value) for value in (3, 4, 5, 6)]
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
                recovery_attempts=0,
                diagnostic_sink=diagnostics.append,
            )

        self.assertEqual(fake_capture.read_calls, 4)
        self.assertTrue(fake_capture.released)
        self.assertTrue(numpy.all(frame == 6))
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0].stabilization_reads, 3)
        self.assertEqual(diagnostics[0].successful_discarded_frames, 3)
        self.assertEqual(diagnostics[0].post_stabilization_attempts, 1)
        self.assertEqual(
            (diagnostics[0].frame_width, diagnostics[0].frame_height), (64, 48)
        )

    def test_black_and_near_zero_frames_are_unhealthy_but_dark_detail_is_usable(
        self,
    ) -> None:
        self.assertEqual(frame_health_reason(healthy_frame(0)), "BLACK_FRAME")
        self.assertEqual(frame_health_reason(healthy_frame(2)), "BLACK_FRAME")

        dark_frame = healthy_frame(0)
        dark_frame[0, 0, 0] = 3
        self.assertIsNone(frame_health_reason(dark_frame))

    def test_invalid_dimensions_and_channel_data_are_rejected(self) -> None:
        self.assertEqual(
            frame_health_reason(numpy.ones((16, 64, 3), dtype=numpy.uint8)),
            "INVALID_FRAME",
        )
        self.assertEqual(
            frame_health_reason(numpy.ones((48, 64), dtype=numpy.uint8)),
            "INVALID_FRAME",
        )

    def test_unhealthy_initial_capture_reopens_and_recovers(self) -> None:
        black_capture = FakeCapture([healthy_frame(0)])
        recovered_capture = FakeCapture([healthy_frame(120)])
        fake_cv2 = FakeCv2([black_capture, recovered_capture])

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.monotonic", return_value=0.0),
            patch("edge.face.camera.time.sleep") as sleep,
        ):
            frame = capture_frame(
                0,
                stabilization_seconds=0.0,
                capture_attempts=1,
                recovery_attempts=2,
                recovery_delay_seconds=0.25,
            )

        self.assertTrue(numpy.all(frame == 120))
        self.assertEqual(fake_cv2.open_calls, 2)
        self.assertTrue(black_capture.released)
        self.assertTrue(recovered_capture.released)
        sleep.assert_called_once_with(0.25)

    def test_persistent_black_frames_exhaust_bounded_recovery(self) -> None:
        captures = [FakeCapture([healthy_frame(0)]) for _ in range(3)]
        fake_cv2 = FakeCv2(captures)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.monotonic", return_value=0.0),
            patch("edge.face.camera.time.sleep"),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=1,
                    recovery_attempts=2,
                )

        self.assertEqual(raised.exception.reason, "BLACK_FRAME")
        self.assertEqual(fake_cv2.open_calls, 3)
        self.assertEqual(sum(capture.read_calls for capture in captures), 3)
        self.assertTrue(all(capture.released for capture in captures))

    def test_camera_open_failure_exhausts_bounded_recovery(self) -> None:
        captures = [FakeCapture(opened=False) for _ in range(3)]
        fake_cv2 = FakeCv2(captures)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep"),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    recovery_attempts=2,
                )

        self.assertEqual(raised.exception.reason, "OPEN_FAILURE")
        self.assertEqual(fake_cv2.open_calls, 3)
        self.assertTrue(all(capture.released for capture in captures))

    def test_read_failure_exhausts_bounded_recovery(self) -> None:
        captures = [FakeCapture() for _ in range(2)]
        fake_cv2 = FakeCv2(captures)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.monotonic", return_value=0.0),
            patch("edge.face.camera.time.sleep"),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=2,
                    recovery_attempts=1,
                )

        self.assertEqual(raised.exception.reason, "READ_FAILURE")
        self.assertEqual(fake_cv2.open_calls, 2)
        self.assertEqual(sum(capture.read_calls for capture in captures), 4)

    def test_stabilization_frame_reads_are_bounded(self) -> None:
        fake_capture = FakeCapture([healthy_frame() for _ in range(10)])
        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            patch("edge.face.camera.time.monotonic", return_value=0.0),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=1.0,
                    max_stabilization_reads=3,
                    recovery_attempts=0,
                )
        self.assertEqual(raised.exception.reason, "READ_FAILURE")
        self.assertEqual(fake_capture.read_calls, 3)
        self.assertTrue(fake_capture.released)

    def test_missing_fresh_frame_returns_camera_error_after_bounded_attempts(
        self,
    ) -> None:
        fake_capture = FakeCapture()
        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            patch("edge.face.camera.time.monotonic", side_effect=[0.0, 0.0, 0.0]),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=2,
                    recovery_attempts=0,
                )
        self.assertEqual(raised.exception.reason, "READ_FAILURE")
        self.assertEqual(fake_capture.read_calls, 2)
        self.assertTrue(fake_capture.released)


if __name__ == "__main__":
    unittest.main()
