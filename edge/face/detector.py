"""Haar-cascade face detection with exactly-one-face validation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import (
    FACE_CROP_MARGIN_RATIO,
    HAAR_MIN_FACE_SIZE,
    HAAR_MIN_NEIGHBORS,
    HAAR_SCALE_FACTOR,
)
from .errors import DependencyError, MultipleFacesError, NoFaceError
from .opencv_support import require_cv2


class HaarFaceDetector:
    def __init__(self, cascade_path: Path | None = None) -> None:
        cv2 = require_cv2()
        resolved_path = cascade_path or (
            Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
        )
        self._classifier = cv2.CascadeClassifier(str(resolved_path))
        if self._classifier.empty():
            raise DependencyError(f"Unable to load Haar cascade: {resolved_path}")

    def extract_single_face(self, frame: Any) -> Any:
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

        face_count = len(faces)
        if face_count == 0:
            raise NoFaceError("No usable face was detected.")
        if face_count > 1:
            raise MultipleFacesError(
                f"Expected exactly one face but detected {face_count}."
            )

        x, y, width, height = (int(value) for value in faces[0])
        margin_x = int(width * FACE_CROP_MARGIN_RATIO)
        margin_y = int(height * FACE_CROP_MARGIN_RATIO)
        x_start = max(0, x - margin_x)
        y_start = max(0, y - margin_y)
        x_end = min(grayscale.shape[1], x + width + margin_x)
        y_end = min(grayscale.shape[0], y + height + margin_y)
        face_crop = grayscale[y_start:y_end, x_start:x_end]
        if face_crop.size == 0:
            raise NoFaceError("The detected face could not be cropped.")
        return face_crop

