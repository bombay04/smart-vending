"""USB webcam capture, content health validation, and bounded recovery."""

from __future__ import annotations

import logging
import math
import time
from typing import Any

import numpy

from .config import (
    BLACK_FRAME_MAX_PIXEL_VALUE,
    DEFAULT_CAMERA_RECOVERY_ATTEMPTS,
    DEFAULT_CAMERA_RECOVERY_DELAY_SECONDS,
    DEFAULT_CAPTURE_HEIGHT,
    DEFAULT_CAPTURE_WIDTH,
    DEFAULT_CAMERA_STABILIZATION_SECONDS,
    MAX_CAMERA_RECOVERY_ATTEMPTS,
    MAX_CAMERA_RECOVERY_DELAY_SECONDS,
    MAX_CAMERA_STABILIZATION_SECONDS,
    MAX_STABILIZATION_FRAME_READS,
    MIN_USABLE_FRAME_DIMENSION,
    POST_STABILIZATION_CAPTURE_ATTEMPTS,
)
from .errors import CameraError
from .diagnostics import CameraCaptureDiagnostics, DiagnosticSink
from .models import CameraProbeResult
from .opencv_support import require_cv2


logger = logging.getLogger("pi-unlock-service.camera")


def frame_health_reason(frame: Any) -> str | None:
    """Return None for a usable BGR frame, otherwise a safe operational reason."""

    if frame is None or getattr(frame, "size", 0) <= 0:
        return "READ_FAILURE"

    try:
        array = numpy.asarray(frame)
        if (
            array.ndim != 3
            or array.shape[0] < MIN_USABLE_FRAME_DIMENSION
            or array.shape[1] < MIN_USABLE_FRAME_DIMENSION
            or array.shape[2] != 3
            or not numpy.issubdtype(array.dtype, numpy.number)
        ):
            return "INVALID_FRAME"
        if not bool(numpy.all(numpy.isfinite(array))):
            return "INVALID_FRAME"
        if float(numpy.max(array)) <= BLACK_FRAME_MAX_PIXEL_VALUE:
            return "BLACK_FRAME"
    except (TypeError, ValueError, OverflowError):
        return "INVALID_FRAME"
    return None


def _set_capture_properties(capture: Any, cv2: Any, width: int, height: int) -> None:
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    # OpenCV backends may ignore this property, but V4L2/FFmpeg backends that
    # support it gain a bounded per-read timeout in addition to the loop limits.
    read_timeout_property = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
    if read_timeout_property is not None:
        capture.set(read_timeout_property, 1000)


def _read_frame(capture: Any) -> tuple[bool, Any]:
    try:
        return capture.read()
    except Exception as error:
        raise CameraError("Camera frame read failed.", reason="READ_FAILURE") from error


def _capture_once(
    camera_index: int,
    *,
    width: int,
    height: int,
    stabilization_seconds: float,
    max_stabilization_reads: int,
    capture_attempts: int,
    diagnostic_sink: DiagnosticSink | None,
) -> Any:
    cv2 = require_cv2()
    try:
        capture = cv2.VideoCapture(camera_index)
    except Exception as error:
        raise CameraError(
            f"Camera index {camera_index} could not be opened.",
            reason="OPEN_FAILURE",
        ) from error
    try:
        if not capture.isOpened():
            raise CameraError(
                f"Camera index {camera_index} could not be opened.",
                reason="OPEN_FAILURE",
            )

        _set_capture_properties(capture, cv2, width, height)

        stabilization_started = time.monotonic()
        stabilization_deadline = stabilization_started + stabilization_seconds
        stabilization_reads = 0
        successful_discarded_frames = 0
        while time.monotonic() < stabilization_deadline:
            if stabilization_reads >= max_stabilization_reads:
                raise CameraError(
                    "Camera stabilization exceeded its bounded frame-read limit.",
                    reason="READ_FAILURE",
                )
            captured, frame = _read_frame(capture)
            stabilization_reads += 1
            if captured and frame_health_reason(frame) is None:
                successful_discarded_frames += 1

        stabilization_elapsed_milliseconds = (
            time.monotonic() - stabilization_started
        ) * 1000.0
        fresh_frame = None
        last_reason = "READ_FAILURE"
        post_stabilization_attempts = 0
        for _ in range(capture_attempts):
            captured, frame = _read_frame(capture)
            post_stabilization_attempts += 1
            if not captured:
                last_reason = "READ_FAILURE"
                continue
            last_reason = frame_health_reason(frame) or ""
            if not last_reason:
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
                f"Camera index {camera_index} did not return a healthy fresh frame.",
                reason=last_reason,
            )
        return fresh_frame
    finally:
        capture.release()


def capture_frame(
    camera_index: int,
    *,
    width: int = DEFAULT_CAPTURE_WIDTH,
    height: int = DEFAULT_CAPTURE_HEIGHT,
    stabilization_seconds: float = DEFAULT_CAMERA_STABILIZATION_SECONDS,
    max_stabilization_reads: int = MAX_STABILIZATION_FRAME_READS,
    capture_attempts: int = POST_STABILIZATION_CAPTURE_ATTEMPTS,
    recovery_attempts: int = DEFAULT_CAMERA_RECOVERY_ATTEMPTS,
    recovery_delay_seconds: float = DEFAULT_CAMERA_RECOVERY_DELAY_SECONDS,
    diagnostic_sink: DiagnosticSink | None = None,
) -> Any:
    """Capture one healthy frame, reopening the camera a bounded number of times."""

    if not 0.0 <= stabilization_seconds <= MAX_CAMERA_STABILIZATION_SECONDS:
        raise ValueError(
            "stabilization_seconds must be between 0.0 and "
            f"{MAX_CAMERA_STABILIZATION_SECONDS}."
        )
    if max_stabilization_reads < 1 or capture_attempts < 1:
        raise ValueError("Camera read limits must be positive integers.")
    if type(recovery_attempts) is not int or not (
        0 <= recovery_attempts <= MAX_CAMERA_RECOVERY_ATTEMPTS
    ):
        raise ValueError(
            "recovery_attempts must be between 0 and "
            f"{MAX_CAMERA_RECOVERY_ATTEMPTS}."
        )
    if not math.isfinite(recovery_delay_seconds) or not (
        0.0 <= recovery_delay_seconds <= MAX_CAMERA_RECOVERY_DELAY_SECONDS
    ):
        raise ValueError(
            "recovery_delay_seconds must be between 0.0 and "
            f"{MAX_CAMERA_RECOVERY_DELAY_SECONDS}."
        )

    last_error: CameraError | None = None
    for open_number in range(recovery_attempts + 1):
        if open_number:
            logger.warning(
                "Camera recovery attempt %s/%s",
                open_number,
                recovery_attempts,
            )
            time.sleep(recovery_delay_seconds)
        try:
            frame = _capture_once(
                camera_index,
                width=width,
                height=height,
                stabilization_seconds=stabilization_seconds,
                max_stabilization_reads=max_stabilization_reads,
                capture_attempts=capture_attempts,
                diagnostic_sink=diagnostic_sink,
            )
        except CameraError as error:
            last_error = error
            if open_number == 0:
                logger.warning(
                    "Unhealthy camera capture detected: %s", error.reason
                )
            continue

        if open_number:
            logger.info("Camera recovered after %s attempt(s)", open_number)
        return frame

    if last_error is None:
        raise RuntimeError("Camera recovery ended without a result.")
    logger.error(
        "Camera unavailable after %s recovery attempt(s): %s",
        recovery_attempts,
        last_error.reason,
    )
    raise last_error


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
                    if captured and frame_health_reason(frame) is None:
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
