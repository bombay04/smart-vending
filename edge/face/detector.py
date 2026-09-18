"""Haar-cascade face detection with exactly-one-face validation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import (
    FACE_SQUARE_CROP_SCALE,
    HAAR_MIN_FACE_SIZE,
    HAAR_MIN_NEIGHBORS,
    HAAR_SCALE_FACTOR,
)
from .diagnostics import DiagnosticSink, FaceDetectionDiagnostics
from .errors import DependencyError, MultipleFacesError, NoFaceError
from .opencv_support import require_cv2


def normalized_square_bounds(
    bounding_box: tuple[int, int, int, int],
    *,
    frame_width: int,
    frame_height: int,
    scale: float = FACE_SQUARE_CROP_SCALE,
) -> tuple[int, int, int, int]:
    """Return a centered, inscribed square clipped to the source frame."""

    if frame_width < 1 or frame_height < 1:
        raise ValueError("Frame dimensions must be positive.")
    if not 0.0 < scale <= 1.0:
        raise ValueError("Square crop scale must be greater than 0.0 and at most 1.0.")

    x, y, width, height = bounding_box
    clipped_x_start = max(0, x)
    clipped_y_start = max(0, y)
    clipped_x_end = min(frame_width, x + width)
    clipped_y_end = min(frame_height, y + height)
    clipped_width = clipped_x_end - clipped_x_start
    clipped_height = clipped_y_end - clipped_y_start
    if clipped_width < 1 or clipped_height < 1:
        raise NoFaceError("The detected face lies outside the captured frame.")

    side = max(1, int(round(min(clipped_width, clipped_height) * scale)))
    center_x = (clipped_x_start + clipped_x_end) / 2.0
    center_y = (clipped_y_start + clipped_y_end) / 2.0
    square_x = int(round(center_x - side / 2.0))
    square_y = int(round(center_y - side / 2.0))
    square_x = min(max(0, square_x), frame_width - side)
    square_y = min(max(0, square_y), frame_height - side)
    return square_x, square_y, side, side


class HaarFaceDetector:
    def __init__(self, cascade_path: Path | None = None) -> None:
        cv2 = require_cv2()
        resolved_path = cascade_path or (
            Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        )
        self._classifier = cv2.CascadeClassifier(str(resolved_path))
        if self._classifier.empty():
            raise DependencyError(f"Unable to load Haar cascade: {resolved_path}")

    def extract_single_face(
        self, frame: Any, *, diagnostic_sink: DiagnosticSink | None = None
    ) -> Any:
        """Return a grayscale crop only when exactly one usable face is present."""

        cv2 = require_cv2()
        if frame is None or getattr(frame, "size", 0) == 0:
            raise NoFaceError("The captured frame is empty.")

        grayscale = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        detection_image = cv2.equalizeHist(grayscale)
        faces = self._classifier.detectMultiScale(
            detection_image,
            scaleFactor=HAAR_SCALE_FACTOR,
            minNeighbors=HAAR_MIN_NEIGHBORS,
            minSize=(HAAR_MIN_FACE_SIZE, HAAR_MIN_FACE_SIZE),
        )

        bounding_boxes = tuple(
            tuple(int(value) for value in face) for face in faces
        )
        face_count = len(bounding_boxes)
        if diagnostic_sink is not None and face_count != 1:
            diagnostic_sink(
                FaceDetectionDiagnostics(
                    frame_width=int(grayscale.shape[1]),
                    frame_height=int(grayscale.shape[0]),
                    bounding_boxes=bounding_boxes,
                )
            )
        if face_count == 0:
            raise NoFaceError("No usable face was detected.")
        if face_count > 1:
            raise MultipleFacesError(
                f"Expected exactly one face but detected {face_count}."
            )

        normalized_crop_box = normalized_square_bounds(
            bounding_boxes[0],
            frame_width=int(grayscale.shape[1]),
            frame_height=int(grayscale.shape[0]),
        )
        crop_x, crop_y, crop_width, crop_height = normalized_crop_box
        face_crop = grayscale[
            crop_y : crop_y + crop_height,
            crop_x : crop_x + crop_width,
        ]
        if face_crop.size == 0:
            raise NoFaceError("The detected face could not be cropped.")
        if diagnostic_sink is not None:
            diagnostic_sink(
                FaceDetectionDiagnostics(
                    frame_width=int(grayscale.shape[1]),
                    frame_height=int(grayscale.shape[0]),
                    bounding_boxes=bounding_boxes,
                    normalized_crop_box=normalized_crop_box,
                    crop_width=int(face_crop.shape[1]),
                    crop_height=int(face_crop.shape[0]),
                )
            )
        return face_crop
