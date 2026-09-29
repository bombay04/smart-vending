"""USB webcam capture, content health validation, and bounded recovery."""

from __future__ import annotations

import logging
import math
import sys
import time
from typing import Any

import numpy

from .config import (
    BLACK_FRAME_MAX_PIXEL_VALUE,
    DEFAULT_CAMERA_RECOVERY_ATTEMPTS,
    DEFAULT_CAMERA_RECOVERY_DELAY_SECONDS,
    DEFAULT_CAMERA_STABILIZATION_SECONDS,
    DEFAULT_CAPTURE_FOURCC,
    DEFAULT_CAPTURE_FPS,
    DEFAULT_CAPTURE_HEIGHT,
    DEFAULT_CAPTURE_WIDTH,
    MAX_CAMERA_RECOVERY_ATTEMPTS,
    MAX_CAMERA_RECOVERY_DELAY_SECONDS,
    MAX_CAMERA_STABILIZATION_SECONDS,
    MAX_STABILIZATION_FRAME_READS,
    MIN_USABLE_FRAME_DIMENSION,
    POST_STABILIZATION_CAPTURE_ATTEMPTS,
)
from .diagnostics import CameraCaptureDiagnostics, DiagnosticSink
from .errors import CameraError
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


def _safe_capture_value(capture: Any, property_id: Any) -> float:
    if property_id is None or not hasattr(capture, "get"):
        return 0.0
    try:
        value = float(capture.get(property_id))
    except Exception:
        return 0.0
    return value if math.isfinite(value) else 0.0


def _decode_fourcc(value: float) -> str:
    encoded = max(0, int(value))
    characters = "".join(chr((encoded >> (8 * offset)) & 0xFF) for offset in range(4))
    return characters if characters.isprintable() and encoded else "UNKNOWN"


class CameraCaptureSession:
    """Explicit, bounded camera lifecycle for one face operation."""

    def __init__(
        self,
        camera_index: int,
        *,
        width: int = DEFAULT_CAPTURE_WIDTH,
        height: int = DEFAULT_CAPTURE_HEIGHT,
        fps: int = DEFAULT_CAPTURE_FPS,
        fourcc: str = DEFAULT_CAPTURE_FOURCC,
        stabilization_seconds: float = DEFAULT_CAMERA_STABILIZATION_SECONDS,
        max_stabilization_reads: int = MAX_STABILIZATION_FRAME_READS,
        capture_attempts: int = POST_STABILIZATION_CAPTURE_ATTEMPTS,
        recovery_attempts: int = DEFAULT_CAMERA_RECOVERY_ATTEMPTS,
        recovery_delay_seconds: float = DEFAULT_CAMERA_RECOVERY_DELAY_SECONDS,
        diagnostic_sink: DiagnosticSink | None = None,
    ) -> None:
        if camera_index < 0:
            raise ValueError("camera_index must be non-negative.")
        if width < 1 or height < 1 or fps < 1:
            raise ValueError("Camera dimensions and FPS must be positive integers.")
        if len(fourcc) != 4:
            raise ValueError("fourcc must contain exactly four characters.")
        if not math.isfinite(stabilization_seconds) or not (
            0.0 <= stabilization_seconds <= MAX_CAMERA_STABILIZATION_SECONDS
        ):
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

        self.camera_index = camera_index
        self.width = width
        self.height = height
        self.fps = fps
        self.fourcc = fourcc
        self.stabilization_seconds = stabilization_seconds
        self.max_stabilization_reads = max_stabilization_reads
        self.capture_attempts = capture_attempts
        self.recovery_attempts = recovery_attempts
        self.recovery_delay_seconds = recovery_delay_seconds
        self.diagnostic_sink = diagnostic_sink
        self._cv2: Any | None = None
        self._capture: Any | None = None
        self._backend = "DEFAULT"
        self._reopen_count = 0
        self._pending_frame: Any | None = None

    def __enter__(self) -> CameraCaptureSession:
        try:
            self._pending_frame = self._capture_with_recovery(warmup=True)
        except Exception:
            self.close()
            raise
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        capture, self._capture = self._capture, None
        self._pending_frame = None
        if capture is not None:
            try:
                capture.release()
            except Exception:
                logger.warning("Camera release failed", exc_info=True)

    def capture_frame(self) -> Any:
        """Return the next healthy frame, reopening the stream if necessary."""

        if self._pending_frame is not None:
            frame, self._pending_frame = self._pending_frame, None
            return frame
        return self._capture_with_recovery(warmup=self._capture is None)

    def _capture_with_recovery(self, *, warmup: bool) -> Any:
        last_error: CameraError | None = None
        while True:
            try:
                if self._capture is None:
                    self._open_capture()
                    warmup = True
                return self._acquire_healthy_frame(warmup=warmup)
            except CameraError as error:
                last_error = error
                self.close()
                if self._reopen_count >= self.recovery_attempts:
                    break
                self._reopen_count += 1
                logger.warning(
                    "Camera recovery attempt %s/%s after %s",
                    self._reopen_count,
                    self.recovery_attempts,
                    error.reason,
                )
                time.sleep(self.recovery_delay_seconds)
                warmup = True

        if last_error is None:
            raise RuntimeError("Camera recovery ended without a result.")
        logger.error(
            "Camera unavailable after %s recovery attempt(s): %s",
            self._reopen_count,
            last_error.reason,
        )
        raise last_error

    def _open_capture(self) -> None:
        self._cv2 = require_cv2()
        v4l2_backend = (
            getattr(self._cv2, "CAP_V4L2", None)
            if sys.platform.startswith("linux")
            else None
        )
        self._backend = "V4L2" if v4l2_backend is not None else "DEFAULT"
        try:
            if v4l2_backend is None:
                capture = self._cv2.VideoCapture(self.camera_index)
            else:
                capture = self._cv2.VideoCapture(self.camera_index, v4l2_backend)
        except Exception as error:
            raise CameraError(
                f"Camera index {self.camera_index} could not be opened.",
                reason="OPEN_FAILURE",
            ) from error

        self._capture = capture
        try:
            opened = bool(capture.isOpened())
        except Exception as error:
            raise CameraError(
                f"Camera index {self.camera_index} could not be opened.",
                reason="OPEN_FAILURE",
            ) from error
        if not opened:
            raise CameraError(
                f"Camera index {self.camera_index} could not be opened.",
                reason="OPEN_FAILURE",
            )
        try:
            self._configure_capture()
        except Exception as error:
            raise CameraError(
                f"Camera index {self.camera_index} could not be configured.",
                reason="OPEN_FAILURE",
            ) from error

    def _configure_capture(self) -> None:
        if self._capture is None or self._cv2 is None:
            raise RuntimeError("Camera capture is not open.")
        capture = self._capture
        cv2 = self._cv2
        requested_fourcc = cv2.VideoWriter_fourcc(*self.fourcc)
        self._try_set_capture_property(cv2.CAP_PROP_FOURCC, requested_fourcc)
        self._try_set_capture_property(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._try_set_capture_property(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._try_set_capture_property(cv2.CAP_PROP_FPS, self.fps)
        self._try_set_capture_property(cv2.CAP_PROP_BUFFERSIZE, 1)

        read_timeout_property = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
        if read_timeout_property is not None:
            self._try_set_capture_property(read_timeout_property, 1000)

        get_backend_name = getattr(capture, "getBackendName", None)
        if callable(get_backend_name):
            try:
                self._backend = str(get_backend_name())
            except Exception:
                pass
        logger.info(
            "Camera stream configured index=%s backend=%s "
            "requested=%sx%s@%s fourcc=%s actual=%sx%s@%.3f fourcc=%s",
            self.camera_index,
            self._backend,
            self.width,
            self.height,
            self.fps,
            self.fourcc,
            int(_safe_capture_value(capture, cv2.CAP_PROP_FRAME_WIDTH)),
            int(_safe_capture_value(capture, cv2.CAP_PROP_FRAME_HEIGHT)),
            _safe_capture_value(capture, cv2.CAP_PROP_FPS),
            _decode_fourcc(_safe_capture_value(capture, cv2.CAP_PROP_FOURCC)),
        )

    def _try_set_capture_property(self, property_id: int, value: float) -> None:
        if self._capture is None:
            return
        try:
            accepted = bool(self._capture.set(property_id, value))
        except Exception:
            accepted = False
        if not accepted:
            logger.info(
                "Camera ignored optional capture property id=%s value=%s",
                property_id,
                value,
            )

    def _read_frame(self) -> tuple[bool, Any]:
        if self._capture is None:
            raise CameraError("Camera stream is not open.", reason="OPEN_FAILURE")
        try:
            return self._capture.read()
        except Exception as error:
            raise CameraError("Camera frame read failed.", reason="READ_FAILURE") from error

    def _acquire_healthy_frame(self, *, warmup: bool) -> Any:
        started = time.monotonic()
        deadline = started + self.stabilization_seconds
        read_count = 0
        unhealthy_frames = 0
        black_frames = 0
        last_reason = "READ_FAILURE"
        healthy_frame = None

        if warmup and self.stabilization_seconds > 0.0:
            while read_count < self.max_stabilization_reads:
                if time.monotonic() >= deadline:
                    break
                captured, frame = self._read_frame()
                read_count += 1
                reason = frame_health_reason(frame) if captured else "READ_FAILURE"
                if reason is None:
                    healthy_frame = frame
                    break
                last_reason = reason
                unhealthy_frames += 1
                if reason == "BLACK_FRAME":
                    black_frames += 1

        post_warmup_reads = 0
        while healthy_frame is None and post_warmup_reads < self.capture_attempts:
            captured, frame = self._read_frame()
            post_warmup_reads += 1
            reason = frame_health_reason(frame) if captured else "READ_FAILURE"
            if reason is None:
                healthy_frame = frame
                break
            last_reason = reason
            unhealthy_frames += 1
            if reason == "BLACK_FRAME":
                black_frames += 1

        read_count += post_warmup_reads
        elapsed_milliseconds = (time.monotonic() - started) * 1000.0
        self._emit_capture_diagnostics(
            healthy_frame,
            warmup_reads=read_count,
            unhealthy_frames=unhealthy_frames,
            black_frames=black_frames,
            elapsed_milliseconds=elapsed_milliseconds,
        )
        if healthy_frame is None:
            raise CameraError(
                f"Camera index {self.camera_index} did not return a healthy fresh frame.",
                reason=last_reason,
            )
        return healthy_frame

    def _emit_capture_diagnostics(
        self,
        frame: Any,
        *,
        warmup_reads: int,
        unhealthy_frames: int,
        black_frames: int,
        elapsed_milliseconds: float,
    ) -> None:
        if self.diagnostic_sink is None or self._capture is None or self._cv2 is None:
            return
        frame_height, frame_width = (
            (int(frame.shape[0]), int(frame.shape[1])) if frame is not None else (0, 0)
        )
        cv2 = self._cv2
        self.diagnostic_sink(
            CameraCaptureDiagnostics(
                camera_index=self.camera_index,
                backend=self._backend,
                requested_width=self.width,
                requested_height=self.height,
                requested_fps=self.fps,
                requested_fourcc=self.fourcc,
                actual_width=int(
                    _safe_capture_value(
                        self._capture, getattr(cv2, "CAP_PROP_FRAME_WIDTH", None)
                    )
                ),
                actual_height=int(
                    _safe_capture_value(
                        self._capture, getattr(cv2, "CAP_PROP_FRAME_HEIGHT", None)
                    )
                ),
                actual_fps=_safe_capture_value(
                    self._capture, getattr(cv2, "CAP_PROP_FPS", None)
                ),
                actual_fourcc=_decode_fourcc(
                    _safe_capture_value(
                        self._capture, getattr(cv2, "CAP_PROP_FOURCC", None)
                    )
                ),
                frame_width=frame_width,
                frame_height=frame_height,
                warmup_reads=warmup_reads,
                unhealthy_frames=unhealthy_frames,
                black_frames=black_frames,
                recovery_attempt=self._reopen_count,
                reopen_count=self._reopen_count,
                time_to_first_healthy_milliseconds=elapsed_milliseconds,
            )
        )


def capture_frame(
    camera_index: int,
    *,
    width: int = DEFAULT_CAPTURE_WIDTH,
    height: int = DEFAULT_CAPTURE_HEIGHT,
    fps: int = DEFAULT_CAPTURE_FPS,
    fourcc: str = DEFAULT_CAPTURE_FOURCC,
    stabilization_seconds: float = DEFAULT_CAMERA_STABILIZATION_SECONDS,
    max_stabilization_reads: int = MAX_STABILIZATION_FRAME_READS,
    capture_attempts: int = POST_STABILIZATION_CAPTURE_ATTEMPTS,
    recovery_attempts: int = DEFAULT_CAMERA_RECOVERY_ATTEMPTS,
    recovery_delay_seconds: float = DEFAULT_CAMERA_RECOVERY_DELAY_SECONDS,
    diagnostic_sink: DiagnosticSink | None = None,
) -> Any:
    """Capture one healthy frame in an explicitly released camera session."""

    with CameraCaptureSession(
        camera_index,
        width=width,
        height=height,
        fps=fps,
        fourcc=fourcc,
        stabilization_seconds=stabilization_seconds,
        max_stabilization_reads=max_stabilization_reads,
        capture_attempts=capture_attempts,
        recovery_attempts=recovery_attempts,
        recovery_delay_seconds=recovery_delay_seconds,
        diagnostic_sink=diagnostic_sink,
    ) as session:
        return session.capture_frame()


def probe_camera_indices(
    start_index: int,
    max_index: int,
    *,
    read_attempts: int = 3,
) -> list[CameraProbeResult]:
    """Report which integer camera indices both open and produce a healthy frame."""

    if start_index < 0 or max_index < start_index:
        raise ValueError("Camera probe indices must be non-negative and ordered.")

    results: list[CameraProbeResult] = []
    for camera_index in range(start_index, max_index + 1):
        try:
            capture_frame(
                camera_index,
                stabilization_seconds=0.0,
                capture_attempts=max(1, read_attempts),
                recovery_attempts=0,
            )
        except CameraError as error:
            results.append(
                CameraProbeResult(
                    camera_index=camera_index,
                    opened=error.reason != "OPEN_FAILURE",
                    captured_frame=False,
                )
            )
        else:
            results.append(
                CameraProbeResult(
                    camera_index=camera_index,
                    opened=True,
                    captured_frame=True,
                )
            )
    return results
