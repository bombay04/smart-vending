from __future__ import annotations

import unittest
from unittest.mock import patch

import numpy

from edge.face.camera import CameraCaptureSession, capture_frame, frame_health_reason
from edge.face.diagnostics import CameraCaptureDiagnostics
from edge.face.errors import CameraError


def healthy_frame(value: int = 120) -> numpy.ndarray:
    return numpy.full((48, 64, 3), value, dtype=numpy.uint8)


def observed_near_black_frame() -> numpy.ndarray:
    frame = numpy.zeros((480, 640, 3), dtype=numpy.uint8)
    frame[0, 0] = 145
    return frame


def sparse_artifact_near_black_frame() -> numpy.ndarray:
    frame = numpy.zeros((480, 640, 3), dtype=numpy.uint8)
    frame.reshape(-1, 3)[:2000] = 100
    return frame


def meaningful_dim_frame() -> numpy.ndarray:
    gradient = numpy.tile(
        numpy.linspace(1, 12, 64, dtype=numpy.uint8),
        (48, 1),
    )
    return numpy.repeat(gradient[:, :, numpy.newaxis], 3, axis=2)


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
        self.set_calls: list[tuple[int, float]] = []
        self.properties: dict[int, float] = {}

    def isOpened(self) -> bool:
        return self.opened

    def set(self, property_id: int, value: float) -> bool:
        self.set_calls.append((property_id, value))
        self.properties[property_id] = value
        return True

    def get(self, property_id: int) -> float:
        return self.properties.get(property_id, 0.0)

    def getBackendName(self) -> str:
        return "V4L2"

    def read(self) -> tuple[bool, numpy.ndarray | None]:
        self.read_calls += 1
        if not self.frames:
            return False, None
        return True, self.frames.pop(0)

    def release(self) -> None:
        self.released = True


class FakeCv2:
    CAP_V4L2 = 200
    CAP_PROP_FRAME_WIDTH = 1
    CAP_PROP_FRAME_HEIGHT = 2
    CAP_PROP_BUFFERSIZE = 3
    CAP_PROP_READ_TIMEOUT_MSEC = 4
    CAP_PROP_FPS = 5
    CAP_PROP_FOURCC = 6

    def __init__(self, captures: FakeCapture | list[FakeCapture]) -> None:
        self.captures = list(captures) if isinstance(captures, list) else [captures]
        self.open_calls: list[tuple[object, ...]] = []

    @staticmethod
    def VideoWriter_fourcc(*characters: str) -> int:
        return sum(ord(character) << (8 * index) for index, character in enumerate(characters))

    def VideoCapture(self, *arguments: object) -> FakeCapture:
        capture = self.captures[len(self.open_calls)]
        self.open_calls.append(arguments)
        return capture


class IgnoringPropertyCapture(FakeCapture):
    def set(self, property_id: int, value: float) -> bool:
        super().set(property_id, value)
        return False


class CameraTests(unittest.TestCase):
    def test_linux_capture_explicitly_requests_v4l2_mjpg_dimensions_and_fps(self) -> None:
        fake_capture = FakeCapture([healthy_frame()])
        fake_cv2 = FakeCv2(fake_capture)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.sys.platform", "linux"),
        ):
            frame = capture_frame(0, stabilization_seconds=0.0, recovery_attempts=0)

        self.assertTrue(numpy.all(frame == 120))
        self.assertEqual(fake_cv2.open_calls, [(0, fake_cv2.CAP_V4L2)])
        self.assertEqual(
            fake_capture.set_calls[:5],
            [
                (fake_cv2.CAP_PROP_FOURCC, fake_cv2.VideoWriter_fourcc(*"MJPG")),
                (fake_cv2.CAP_PROP_FRAME_WIDTH, 640),
                (fake_cv2.CAP_PROP_FRAME_HEIGHT, 480),
                (fake_cv2.CAP_PROP_FPS, 30),
                (fake_cv2.CAP_PROP_BUFFERSIZE, 1),
            ],
        )
        self.assertTrue(fake_capture.released)

    def test_startup_black_frames_are_discarded_until_first_healthy_frame(self) -> None:
        fake_capture = FakeCapture(
            [healthy_frame(0), healthy_frame(2), healthy_frame(80)]
        )
        diagnostics: list[CameraCaptureDiagnostics] = []

        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            patch("edge.face.camera.time.monotonic", side_effect=[0.0, 0.1, 0.2, 0.3, 0.3]),
        ):
            frame = capture_frame(
                0,
                stabilization_seconds=1.0,
                recovery_attempts=0,
                diagnostic_sink=diagnostics.append,
            )

        self.assertTrue(numpy.all(frame == 80))
        self.assertEqual(fake_capture.read_calls, 3)
        self.assertEqual(diagnostics[0].warmup_reads, 3)
        self.assertEqual(diagnostics[0].unhealthy_frames, 2)
        self.assertEqual(diagnostics[0].black_frames, 2)
        self.assertEqual(diagnostics[0].backend, "V4L2")

    def test_ignored_optional_capture_properties_do_not_block_healthy_stream(self) -> None:
        fake_capture = IgnoringPropertyCapture([healthy_frame(90)])
        with patch(
            "edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)
        ):
            frame = capture_frame(0, stabilization_seconds=0.0, recovery_attempts=0)

        self.assertEqual(int(frame[0, 0, 0]), 90)
        self.assertTrue(fake_capture.released)

    def test_exact_black_and_observed_sparse_near_black_frames_are_rejected(self) -> None:
        self.assertEqual(frame_health_reason(healthy_frame(0)), "BLACK_FRAME")
        self.assertEqual(frame_health_reason(healthy_frame(2)), "BLACK_FRAME")
        self.assertEqual(
            frame_health_reason(observed_near_black_frame()),
            "NEAR_BLACK_FRAME",
        )

    def test_sparse_artifacts_above_ratio_threshold_cannot_veto_near_black(self) -> None:
        frame = sparse_artifact_near_black_frame()
        bright_ratio = float(numpy.mean(frame[:, :, 0] > 16))

        self.assertGreater(bright_ratio, 0.001)
        self.assertEqual(float(numpy.percentile(frame[:, :, 0], 99)), 0.0)
        self.assertEqual(frame_health_reason(frame), "NEAR_BLACK_FRAME")

    def test_normal_frame_is_healthy(self) -> None:
        self.assertIsNone(frame_health_reason(healthy_frame(120)))

    def test_dim_frame_with_meaningful_distribution_and_detail_is_healthy(self) -> None:
        self.assertIsNone(frame_health_reason(meaningful_dim_frame()))

    def test_invalid_dimensions_and_channel_data_are_rejected(self) -> None:
        self.assertEqual(
            frame_health_reason(numpy.ones((16, 64, 3), dtype=numpy.uint8)),
            "INVALID_FRAME",
        )
        self.assertEqual(
            frame_health_reason(numpy.ones((48, 64), dtype=numpy.uint8)),
            "INVALID_FRAME",
        )

    def test_all_black_stream_reopens_and_successful_reopen_returns_frame(self) -> None:
        black_capture = FakeCapture([healthy_frame(0), healthy_frame(0)])
        recovered_capture = FakeCapture([healthy_frame(120)])
        fake_cv2 = FakeCv2([black_capture, recovered_capture])

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep") as sleep,
        ):
            frame = capture_frame(
                0,
                stabilization_seconds=0.0,
                capture_attempts=2,
                recovery_attempts=2,
                recovery_delay_seconds=0.25,
            )

        self.assertTrue(numpy.all(frame == 120))
        self.assertEqual(len(fake_cv2.open_calls), 2)
        self.assertTrue(black_capture.released)
        self.assertTrue(recovered_capture.released)
        sleep.assert_called_once_with(0.25)

    def test_persistent_black_stream_exhausts_recovery_and_releases_every_open(self) -> None:
        captures = [FakeCapture([healthy_frame(0)]) for _ in range(3)]
        fake_cv2 = FakeCv2(captures)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
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
        self.assertEqual(len(fake_cv2.open_calls), 3)
        self.assertTrue(all(capture.released for capture in captures))

    def test_opened_all_black_device_is_not_healthy(self) -> None:
        fake_capture = FakeCapture([healthy_frame(0), healthy_frame(0)])
        with patch(
            "edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=2,
                    recovery_attempts=0,
                )
        self.assertEqual(raised.exception.reason, "BLACK_FRAME")
        self.assertTrue(fake_capture.released)

    def test_opened_near_black_device_is_not_healthy(self) -> None:
        fake_capture = FakeCapture([observed_near_black_frame()])
        diagnostics: list[CameraCaptureDiagnostics] = []
        with patch(
            "edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=1,
                    recovery_attempts=0,
                    diagnostic_sink=diagnostics.append,
                )
        self.assertEqual(raised.exception.reason, "NEAR_BLACK_FRAME")
        self.assertTrue(fake_capture.released)
        self.assertEqual(diagnostics[0].last_frame_health, "NEAR_BLACK_FRAME")
        self.assertEqual(diagnostics[0].near_black_frames, 1)
        self.assertIsNotNone(diagnostics[0].grayscale_mean)
        self.assertIsNotNone(diagnostics[0].bright_pixel_ratio)
        self.assertLess(float(diagnostics[0].grayscale_mean), 1.0)
        self.assertEqual(diagnostics[0].grayscale_p99, 0.0)
        self.assertLess(float(diagnostics[0].bright_pixel_ratio), 0.001)

    def test_camera_open_failure_exhausts_recovery_and_releases(self) -> None:
        captures = [FakeCapture(opened=False) for _ in range(3)]
        fake_cv2 = FakeCv2(captures)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep"),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(0, stabilization_seconds=0.0, recovery_attempts=2)

        self.assertEqual(raised.exception.reason, "OPEN_FAILURE")
        self.assertEqual(len(fake_cv2.open_calls), 3)
        self.assertTrue(all(capture.released for capture in captures))

    def test_read_failures_exhaust_bounded_recovery(self) -> None:
        captures = [FakeCapture() for _ in range(2)]
        fake_cv2 = FakeCv2(captures)

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
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
        self.assertEqual(sum(capture.read_calls for capture in captures), 4)
        self.assertTrue(all(capture.released for capture in captures))

    def test_one_session_supplies_multiple_frames_with_one_open_and_one_release(self) -> None:
        fake_capture = FakeCapture(
            [healthy_frame(10), healthy_frame(20), healthy_frame(30)]
        )
        fake_cv2 = FakeCv2(fake_capture)

        with patch("edge.face.camera.require_cv2", return_value=fake_cv2):
            with CameraCaptureSession(
                0, stabilization_seconds=0.0, recovery_attempts=0
            ) as session:
                frames = [session.capture_frame() for _ in range(3)]
                self.assertFalse(fake_capture.released)

        self.assertEqual(len(fake_cv2.open_calls), 1)
        self.assertTrue(fake_capture.released)
        self.assertEqual([int(frame[0, 0, 0]) for frame in frames], [10, 20, 30])

    def test_persistent_black_frames_mid_session_trigger_bounded_reopen(self) -> None:
        first_capture = FakeCapture(
            [healthy_frame(10), healthy_frame(0), healthy_frame(0)]
        )
        recovered_capture = FakeCapture([healthy_frame(20)])
        fake_cv2 = FakeCv2([first_capture, recovered_capture])

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep") as sleep,
        ):
            with CameraCaptureSession(
                0,
                stabilization_seconds=0.0,
                capture_attempts=2,
                recovery_attempts=1,
            ) as session:
                first_frame = session.capture_frame()
                second_frame = session.capture_frame()

        self.assertEqual(int(first_frame[0, 0, 0]), 10)
        self.assertEqual(int(second_frame[0, 0, 0]), 20)
        self.assertEqual(len(fake_cv2.open_calls), 2)
        self.assertTrue(first_capture.released)
        self.assertTrue(recovered_capture.released)
        sleep.assert_called_once()

    def test_escalation_hook_is_not_called_when_capture_is_healthy(self) -> None:
        fake_capture = FakeCapture([healthy_frame()])
        hook_calls: list[str] = []

        with patch(
            "edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)
        ):
            frame = capture_frame(
                0,
                stabilization_seconds=0.0,
                recovery_attempts=1,
                recovery_escalation=lambda: hook_calls.append("called"),
            )

        self.assertEqual(int(frame[0, 0, 0]), 120)
        self.assertEqual(hook_calls, [])

    def test_escalation_hook_runs_once_after_reopen_exhaustion_and_can_recover(self) -> None:
        captures = [
            FakeCapture([observed_near_black_frame()]),
            FakeCapture([observed_near_black_frame()]),
            FakeCapture([healthy_frame(90)]),
        ]
        fake_cv2 = FakeCv2(captures)
        hook_calls: list[str] = []

        def recovery_hook() -> None:
            self.assertTrue(captures[0].released)
            self.assertTrue(captures[1].released)
            hook_calls.append("called")

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep"),
        ):
            frame = capture_frame(
                0,
                stabilization_seconds=0.0,
                capture_attempts=1,
                recovery_attempts=1,
                recovery_escalation=recovery_hook,
            )

        self.assertEqual(int(frame[0, 0, 0]), 90)
        self.assertEqual(hook_calls, ["called"])
        self.assertEqual(len(fake_cv2.open_calls), 3)
        self.assertTrue(all(capture.released for capture in captures))

    def test_continued_failure_after_escalation_stays_bounded(self) -> None:
        captures = [
            FakeCapture([observed_near_black_frame()]) for _ in range(3)
        ]
        fake_cv2 = FakeCv2(captures)
        hook_calls: list[str] = []

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep"),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=1,
                    recovery_attempts=1,
                    recovery_escalation=lambda: hook_calls.append("called"),
                )

        self.assertEqual(raised.exception.reason, "NEAR_BLACK_FRAME")
        self.assertEqual(hook_calls, ["called"])
        self.assertEqual(len(fake_cv2.open_calls), 3)
        self.assertTrue(all(capture.released for capture in captures))

    def test_escalation_hook_exception_fails_safely_without_another_open(self) -> None:
        captures = [
            FakeCapture([observed_near_black_frame()]) for _ in range(2)
        ]
        fake_cv2 = FakeCv2(captures)
        hook_calls: list[str] = []

        def failing_hook() -> None:
            hook_calls.append("called")
            raise RuntimeError("uhubctl is intentionally not wired")

        with (
            patch("edge.face.camera.require_cv2", return_value=fake_cv2),
            patch("edge.face.camera.time.sleep"),
        ):
            with self.assertRaises(CameraError) as raised:
                capture_frame(
                    0,
                    stabilization_seconds=0.0,
                    capture_attempts=1,
                    recovery_attempts=1,
                    recovery_escalation=failing_hook,
                )

        self.assertEqual(raised.exception.reason, "NEAR_BLACK_FRAME")
        self.assertEqual(hook_calls, ["called"])
        self.assertEqual(len(fake_cv2.open_calls), 2)
        self.assertTrue(all(capture.released for capture in captures))

    def test_session_releases_capture_when_caller_raises(self) -> None:
        fake_capture = FakeCapture([healthy_frame()])
        with (
            patch("edge.face.camera.require_cv2", return_value=FakeCv2(fake_capture)),
            self.assertRaisesRegex(RuntimeError, "pipeline failed"),
        ):
            with CameraCaptureSession(
                0, stabilization_seconds=0.0, recovery_attempts=0
            ):
                raise RuntimeError("pipeline failed")
        self.assertTrue(fake_capture.released)


if __name__ == "__main__":
    unittest.main()
