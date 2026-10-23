"""Single-camera live preview and active liveness scan orchestration.

This deliberately uses the same ``CameraCaptureSession`` for preview,
liveness, and embeddings.  Preview frames are callbacks only; callers must
keep them local and ephemeral.
"""

from __future__ import annotations

import math
import secrets
import time
from collections.abc import Callable
from typing import Any, Literal

from .camera import CameraCaptureSession
from .engine import FaceEngine
from .errors import (
    LivenessError,
    MultipleFacesError,
    NoFaceError,
    ScanCancelledError,
)


Challenge = Literal["TURN_LEFT", "TURN_RIGHT"]
StateCallback = Callable[[str, Challenge | None, int, int], None]
PreviewCallback = Callable[[Any], None]

DEFAULT_SCAN_TIMEOUT_SECONDS = 20.0
BASELINE_FRAME_COUNT = 4
CHALLENGE_HOLD_FRAMES = 2
RETURN_HOLD_FRAMES = 2
YAW_CHALLENGE_DELTA = 0.16
YAW_RETURN_TOLERANCE = 0.08
MIN_FACE_WIDTH_RATIO = 0.18
MAX_FACE_WIDTH_RATIO = 0.72


def _yaw_signal(detection: Any) -> float:
    """Estimate yaw from YuNet's eye/nose landmarks, independent of position."""

    right_eye_x = float(detection[4])
    left_eye_x = float(detection[6])
    nose_x = float(detection[8])
    eye_span = abs(left_eye_x - right_eye_x)
    if not math.isfinite(eye_span) or eye_span < 1.0:
        raise NoFaceError("Face landmarks are not stable enough for liveness.")
    eye_midpoint = (right_eye_x + left_eye_x) / 2.0
    return (nose_x - eye_midpoint) / eye_span


def _face_is_positioned(frame: Any, detection: Any) -> bool:
    height, width = int(frame.shape[0]), int(frame.shape[1])
    x, y, face_width, face_height = (float(value) for value in detection[:4])
    center_x = (x + face_width / 2.0) / width
    center_y = (y + face_height / 2.0) / height
    width_ratio = face_width / width
    return (
        0.25 <= center_x <= 0.75
        and 0.18 <= center_y <= 0.82
        and MIN_FACE_WIDTH_RATIO <= width_ratio <= MAX_FACE_WIDTH_RATIO
    )


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def collect_liveness_verified_embeddings(
    engine: FaceEngine,
    *,
    sample_count: int,
    state_callback: StateCallback,
    preview_callback: PreviewCallback,
    cancelled: Callable[[], bool],
    timeout_seconds: float = DEFAULT_SCAN_TIMEOUT_SECONDS,
    challenge: Challenge | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[tuple[float, ...], ...]:
    """Run a random head-turn challenge and return identity-bound embeddings.

    The check is intentionally fail-closed.  It mitigates an unmoving printed
    photo or phone display, but is not presentation-attack detection and must
    not be represented as production-grade anti-spoofing.
    """

    if sample_count < 1:
        raise ValueError("sample_count must be positive.")
    selected_challenge = challenge or secrets.choice(("TURN_LEFT", "TURN_RIGHT"))
    deadline = clock() + timeout_seconds
    baseline_yaws: list[float] = []
    baseline_embedding: tuple[float, ...] | None = None
    challenge_frames = 0
    return_frames = 0
    phase = "POSITION_FACE"
    last_detection_error: type[Exception] | None = None

    state_callback("CAMERA_STARTING", None, 0, sample_count)
    with CameraCaptureSession(
        engine.camera_index,
        stabilization_seconds=engine.stabilization_seconds,
        recovery_escalation=engine.camera_recovery_escalation,
        diagnostic_sink=engine.diagnostic_sink,
    ) as camera:
        while clock() < deadline:
            if cancelled():
                raise ScanCancelledError("Face scan was cancelled.")

            frame = camera.capture_frame()
            preview_callback(frame)
            try:
                detection = engine.detector.detect_single_face(
                    frame, diagnostic_sink=engine.diagnostic_sink
                )
            except (NoFaceError, MultipleFacesError) as error:
                last_detection_error = type(error)
                state_callback(error.code, None, 0, sample_count)
                baseline_yaws.clear()
                baseline_embedding = None
                phase = "POSITION_FACE"
                challenge_frames = 0
                return_frames = 0
                continue

            last_detection_error = None
            if not _face_is_positioned(frame, detection):
                state_callback("POSITION_FACE", None, 0, sample_count)
                baseline_yaws.clear()
                baseline_embedding = None
                phase = "POSITION_FACE"
                continue

            yaw = _yaw_signal(detection)
            if phase == "POSITION_FACE":
                baseline_yaws.append(yaw)
                state_callback("FACE_DETECTED", None, len(baseline_yaws), BASELINE_FRAME_COUNT)
                if len(baseline_yaws) < BASELINE_FRAME_COUNT:
                    continue
                baseline_yaw = _median(baseline_yaws)
                baseline_embedding = engine.embedder.create_embedding(
                    frame, detection, diagnostic_sink=engine.diagnostic_sink
                )
                phase = "CHALLENGE"
                state_callback(selected_challenge, selected_challenge, 0, CHALLENGE_HOLD_FRAMES)
                continue

            baseline_yaw = _median(baseline_yaws)
            if phase == "CHALLENGE":
                delta = yaw - baseline_yaw
                # This sign contract is server-side and intentionally independent
                # of how the kiosk preview is mirrored or rendered.
                passed_direction = (
                    delta <= -YAW_CHALLENGE_DELTA
                    if selected_challenge == "TURN_LEFT"
                    else delta >= YAW_CHALLENGE_DELTA
                )
                challenge_frames = challenge_frames + 1 if passed_direction else 0
                state_callback(
                    selected_challenge,
                    selected_challenge,
                    challenge_frames,
                    CHALLENGE_HOLD_FRAMES,
                )
                if challenge_frames >= CHALLENGE_HOLD_FRAMES:
                    phase = "RETURN_CENTER"
                continue

            if phase == "RETURN_CENTER":
                returned = abs(yaw - baseline_yaw) <= YAW_RETURN_TOLERANCE
                return_frames = return_frames + 1 if returned else 0
                state_callback(
                    "RETURN_CENTER",
                    selected_challenge,
                    return_frames,
                    RETURN_HOLD_FRAMES,
                )
                if return_frames < RETURN_HOLD_FRAMES:
                    continue
                phase = "COLLECT"

            if phase == "COLLECT":
                if baseline_embedding is None:
                    raise LivenessError("Liveness identity baseline is unavailable.")
                embedding = engine.embedder.create_embedding(
                    frame, detection, diagnostic_sink=engine.diagnostic_sink
                )
                if engine.embedder.distance(baseline_embedding, embedding) > engine.threshold:
                    raise LivenessError("Face identity changed during liveness verification.")
                embeddings = [baseline_embedding, embedding]
                embeddings = embeddings[:sample_count]
                while len(embeddings) < sample_count and clock() < deadline:
                    if cancelled():
                        raise ScanCancelledError("Face scan was cancelled.")
                    sample_frame = camera.capture_frame()
                    preview_callback(sample_frame)
                    sample_detection = engine.detector.detect_single_face(
                        sample_frame, diagnostic_sink=engine.diagnostic_sink
                    )
                    if not _face_is_positioned(sample_frame, sample_detection):
                        state_callback("POSITION_FACE", selected_challenge, len(embeddings), sample_count)
                        continue
                    sample_embedding = engine.embedder.create_embedding(
                        sample_frame,
                        sample_detection,
                        diagnostic_sink=engine.diagnostic_sink,
                    )
                    if engine.embedder.distance(baseline_embedding, sample_embedding) > engine.threshold:
                        raise LivenessError("Face identity changed during sample collection.")
                    embeddings.append(sample_embedding)
                    state_callback("VERIFYING", selected_challenge, len(embeddings), sample_count)
                if len(embeddings) == sample_count:
                    return tuple(embeddings)
                break

    if last_detection_error is MultipleFacesError:
        raise MultipleFacesError("Multiple faces prevented liveness verification.")
    if last_detection_error is NoFaceError and not baseline_yaws:
        raise NoFaceError("No face was available for liveness verification.")
    raise LivenessError("The liveness challenge was not completed before timeout.")

