"""USB webcam capture and camera-index probing."""

from __future__ import annotations

from typing import Any

from .config import (
    DEFAULT_CAPTURE_HEIGHT,
    DEFAULT_CAPTURE_WIDTH,
    DEFAULT_WARMUP_FRAMES,
)
from .errors import CameraError
from .models import CameraProbeResult
from .opencv_support import require_cv2


def _valid_frame(frame: Any) -> bool:
    return frame is not None and getattr(frame, "size", 0) > 0


def capture_frame(
    camera_index: int,
    *,
    width: int = DEFAULT_CAPTURE_WIDTH,
    height: int = DEFAULT_CAPTURE_HEIGHT,
    warmup_frames: int = DEFAULT_WARMUP_FRAMES,
) -> Any:
    """Open one camera index and return the latest successfully captured frame."""

    cv2 = require_cv2()
    capture = cv2.VideoCapture(camera_index)
    try:
        if not capture.isOpened():
            raise CameraError(f"Camera index {camera_index} could not be opened.")

        capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        latest_frame = None
        for _ in range(max(1, warmup_frames + 1)):
            captured, frame = capture.read()
            if captured and _valid_frame(frame):
                latest_frame = frame

        if latest_frame is None:
            raise CameraError(
                f"Camera index {camera_index} opened but did not return a frame."
            )
        return latest_frame
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

