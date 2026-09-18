"""USB webcam capture and camera-index probing."""

from __future__ import annotations

import time
from typing import Any

from .config import (
    DEFAULT_CAPTURE_HEIGHT,
    DEFAULT_CAPTURE_WIDTH,
    DEFAULT_CAMERA_STABILIZATION_SECONDS,
    MAX_CAMERA_STABILIZATION_SECONDS,
    MAX_STABILIZATION_FRAME_READS,
    POST_STABILIZATION_CAPTURE_ATTEMPTS,
)
from .errors import CameraError
from .diagnostics import CameraCaptureDiagnostics, DiagnosticSink
from .models import CameraProbeResult
from .opencv_support import require_cv2


def _valid_frame(frame: Any) -> bool:
    return frame is not None and getattr(frame, "size", 0) > 0


def capture_frame(
    camera_index: int,
    *,
    width: int = DEFAULT_CAPTURE_WIDTH,
    height: int = DEFAULT_CAPTURE_HEIGHT,
    stabilization_seconds: float = DEFAULT_CAMERA_STABILIZATION_SECONDS,
    max_stabilization_reads: int = MAX_STABILIZATION_FRAME_READS,
    capture_attempts: int = POST_STABILIZATION_CAPTURE_ATTEMPTS,
    diagnostic_sink: DiagnosticSink | None = None,
) -> Any:
    """Continuously discard frames while controls settle, then capture a fresh frame."""

    if not 0.0 <= stabilization_seconds <= MAX_CAMERA_STABILIZATION_SECONDS:
        raise ValueError(
            "stabilization_seconds must be between 0.0 and "
            f"{MAX_CAMERA_STABILIZATION_SECONDS}."
        )
    if max_stabilization_reads < 1 or capture_attempts < 1:
        raise ValueError("Camera read limits must be positive integers.")

    cv2 = require_cv2()
    capture = cv2.VideoCapture(camera_index)
    try:
        if not capture.isOpened():
            raise CameraError(f"Camera index {camera_index} could not be opened.")

        capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        stabilization_started = time.monotonic()
        stabilization_deadline = stabilization_started + stabilization_seconds
        stabilization_reads = 0
        successful_discarded_frames = 0
        while time.monotonic() < stabilization_deadline:
            if stabilization_reads >= max_stabilization_reads:
                raise CameraError(
                    "Camera stabilization exceeded its bounded frame-read limit."
                )
            captured, frame = capture.read()
            stabilization_reads += 1
            if captured and _valid_frame(frame):
                successful_discarded_frames += 1

        stabilization_elapsed_milliseconds = (
            time.monotonic() - stabilization_started
        ) * 1000.0
        fresh_frame = None
        post_stabilization_attempts = 0
        for _ in range(capture_attempts):
            captured, frame = capture.read()
            post_stabilization_attempts += 1
            if captured and _valid_frame(frame):
                fresh_frame = frame
                break

        if diagnostic_sink is not None:
            frame_height, frame_width = (
                (int(fresh_frame.shape[0]), int(fresh_frame.shape[1]))
                if fresh_frame is not None
                else (0, 0)
            )
            diagnostic_sink(
                CameraCaptureDiagnostics(
                    camera_index=camera_index,
                    frame_width=frame_width,
                    frame_height=frame_height,
                    stabilization_seconds=stabilization_seconds,
                    stabilization_elapsed_milliseconds=(
                        stabilization_elapsed_milliseconds
                    ),
                    stabilization_reads=stabilization_reads,
                    successful_discarded_frames=successful_discarded_frames,
                    post_stabilization_attempts=post_stabilization_attempts,
                )
            )

        if fresh_frame is None:
            raise CameraError(
                f"Camera index {camera_index} did not return a fresh frame after "
                "stabilization."
            )
        return fresh_frame
    finally:
        capture.release()


def probe_camera_indices(
    start_index: int,
    max_index: int,
    *,
    read_attempts: int = 3,
) -> list[CameraProbeResult]:
    """Report which integer camera indices both open and produce a frame."""

    if start_index < 0 or max_index < start_index:
        raise ValueError("Camera probe indices must be non-negative and ordered.")

    cv2 = require_cv2()
    results: list[CameraProbeResult] = []
    for camera_index in range(start_index, max_index + 1):
        capture = cv2.VideoCapture(camera_index)
        try:
            opened = bool(capture.isOpened())
            captured_frame = False
            if opened:
                for _ in range(max(1, read_attempts)):
                    captured, frame = capture.read()
                    if captured and _valid_frame(frame):
                        captured_frame = True
                        break
            results.append(
                CameraProbeResult(
                    camera_index=camera_index,
                    opened=opened,
                    captured_frame=captured_frame,
                )
            )
        finally:
            capture.release()
    return results
