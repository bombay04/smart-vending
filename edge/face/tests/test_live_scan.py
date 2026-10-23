from __future__ import annotations

import unittest
from unittest.mock import patch

from edge.face.errors import LivenessError, ScanCancelledError
from edge.face.live_scan import collect_liveness_verified_embeddings


class Frame:
    shape = (100, 100, 3)

    def __init__(self, marker: float = 0.0) -> None:
        self.marker = marker


def detection(nose_x: float = 50.0):
    # bbox, right eye, left eye, nose, mouth corners, confidence
    return [20, 10, 60, 70, 40, 35, 60, 35, nose_x, 50, 43, 65, 57, 65, 0.99]


class Detector:
    def __init__(self, detections):
        self.detections = list(detections)
        self.calls = 0

    def detect_single_face(self, _frame, **_kwargs):
        value = self.detections[min(self.calls, len(self.detections) - 1)]
        self.calls += 1
        if isinstance(value, Exception):
            raise value
        return value


class Embedder:
    def create_embedding(self, frame, _detection, **_kwargs):
        return (float(frame.marker),)

    def distance(self, first, second):
        return abs(first[0] - second[0])


class Engine:
    camera_index = 0
    stabilization_seconds = 0.0
    camera_recovery_escalation = None
    diagnostic_sink = None
    threshold = 0.5

    def __init__(self, detections):
        self.detector = Detector(detections)
        self.embedder = Embedder()


class Camera:
    def __init__(self, frames):
        self.frames = list(frames)
        self.index = 0
        self.entered = 0
        self.exited = 0

    def __enter__(self):
        self.entered += 1
        return self

    def __exit__(self, *_args):
        self.exited += 1

    def capture_frame(self):
        frame = self.frames[min(self.index, len(self.frames) - 1)]
        self.index += 1
        return frame


class IncrementingClock:
    def __init__(self, step=0.1):
        self.value = 0.0
        self.step = step

    def __call__(self):
        self.value += self.step
        return self.value


class LiveScanTests(unittest.TestCase):
    def run_scan(self, detections, frames=None, **kwargs):
        frames = frames or [Frame()] * 20
        camera = Camera(frames)
        states = []
        with patch("edge.face.live_scan.CameraCaptureSession", return_value=camera):
            result = collect_liveness_verified_embeddings(
                Engine(detections),
                sample_count=3,
                state_callback=lambda *state: states.append(state),
                preview_callback=lambda _frame: None,
                cancelled=lambda: False,
                challenge="TURN_LEFT",
                clock=IncrementingClock(0.01),
                **kwargs,
            )
        return result, states, camera

    def test_realistic_head_turn_passes_and_uses_one_camera_session(self):
        detections = (
            [detection()] * 4
            + [detection(46), detection(46)]
            + [detection(), detection()]
            + [detection()] * 3
        )
        embeddings, states, camera = self.run_scan(detections)
        self.assertEqual(len(embeddings), 3)
        self.assertEqual(camera.entered, 1)
        self.assertEqual(camera.exited, 1)
        self.assertIn("TURN_LEFT", [state[0] for state in states])
        self.assertIn("VERIFYING", [state[0] for state in states])

    def test_opposite_server_selected_direction_uses_positive_yaw_delta(self):
        detections = (
            [detection()] * 4
            + [detection(54), detection(54)]
            + [detection(), detection()]
            + [detection()] * 3
        )
        camera = Camera([Frame()] * 20)
        states = []
        with patch("edge.face.live_scan.CameraCaptureSession", return_value=camera):
            embeddings = collect_liveness_verified_embeddings(
                Engine(detections),
                sample_count=3,
                state_callback=lambda *state: states.append(state),
                preview_callback=lambda _frame: None,
                cancelled=lambda: False,
                challenge="TURN_RIGHT",
                clock=IncrementingClock(0.01),
            )

        self.assertEqual(len(embeddings), 3)
        self.assertIn("TURN_RIGHT", [state[0] for state in states])

    def test_static_photo_or_phone_display_fails_the_challenge(self):
        camera = Camera([Frame()] * 50)
        with patch("edge.face.live_scan.CameraCaptureSession", return_value=camera):
            with self.assertRaises(LivenessError):
                collect_liveness_verified_embeddings(
                    Engine([detection()] * 50),
                    sample_count=3,
                    state_callback=lambda *_state: None,
                    preview_callback=lambda _frame: None,
                    cancelled=lambda: False,
                    challenge="TURN_LEFT",
                    timeout_seconds=0.8,
                    clock=IncrementingClock(0.1),
                )
        self.assertEqual(camera.exited, 1)

    def test_identity_swap_after_challenge_fails_closed(self):
        detections = [detection()] * 4 + [detection(46)] * 2 + [detection()] * 5
        frames = [Frame(0.0)] * 7 + [Frame(1.0)] * 5
        with self.assertRaises(LivenessError):
            self.run_scan(detections, frames=frames)

    def test_cancel_releases_camera(self):
        camera = Camera([Frame()] * 10)
        calls = 0

        def cancelled():
            nonlocal calls
            calls += 1
            return calls > 1

        with patch("edge.face.live_scan.CameraCaptureSession", return_value=camera):
            with self.assertRaises(ScanCancelledError):
                collect_liveness_verified_embeddings(
                    Engine([detection()] * 10),
                    sample_count=3,
                    state_callback=lambda *_state: None,
                    preview_callback=lambda _frame: None,
                    cancelled=cancelled,
                    challenge="TURN_LEFT",
                    clock=IncrementingClock(0.01),
                )
        self.assertEqual(camera.exited, 1)


if __name__ == "__main__":
    unittest.main()
