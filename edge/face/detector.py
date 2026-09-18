"""YuNet face detection with an exactly-one-valid-face policy."""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any

import numpy

from .config import (
    DEFAULT_YUNET_MODEL_PATH,
    YUNET_DETECTION_VALUE_COUNT,
    YUNET_NMS_THRESHOLD,
    YUNET_SCORE_THRESHOLD,
    YUNET_TOP_K,
)
from .diagnostics import (
    DiagnosticSink,
    FaceDetectionDiagnostics,
    InferenceTimingDiagnostics,
)
from .errors import DetectionError, ModelError, MultipleFacesError, NoFaceError
from .opencv_support import require_cv2


class YuNetFaceDetector:
    def __init__(
        self,
        model_path: Path = DEFAULT_YUNET_MODEL_PATH,
        *,
        cv2_module: Any | None = None,
    ) -> None:
        self.model_path = Path(model_path)
        if not self.model_path.is_file():
            raise ModelError(f"YuNet model is missing: {self.model_path}")

        self._cv2 = cv2_module or require_cv2()
        try:
            self._detector = self._cv2.FaceDetectorYN.create(
                str(self.model_path),
                "",
                (320, 320),
                YUNET_SCORE_THRESHOLD,
                YUNET_NMS_THRESHOLD,
                YUNET_TOP_K,
                self._cv2.dnn.DNN_BACKEND_OPENCV,
                self._cv2.dnn.DNN_TARGET_CPU,
            )
        except Exception as error:
            raise ModelError(
                f"YuNet model could not be loaded: {self.model_path}"
            ) from error
        if self._detector is None:
            raise ModelError(f"YuNet model could not be loaded: {self.model_path}")

    def detect_single_face(
        self, frame: Any, *, diagnostic_sink: DiagnosticSink | None = None
    ) -> Any:
        if frame is None or getattr(frame, "size", 0) == 0:
            raise NoFaceError("The captured frame is empty.")

        try:
            frame_height = int(frame.shape[0])
            frame_width = int(frame.shape[1])
            self._detector.setInputSize((frame_width, frame_height))
            started = time.perf_counter()
            detection_result = self._detector.detect(frame)
            elapsed_milliseconds = (time.perf_counter() - started) * 1000.0
        except Exception as error:
            raise DetectionError("YuNet face detection failed.") from error

        if diagnostic_sink is not None:
            diagnostic_sink(
                InferenceTimingDiagnostics(
                    stage="yunetDetection",
                    elapsed_milliseconds=elapsed_milliseconds,
                )
            )

        faces = (
            detection_result[1]
            if isinstance(detection_result, tuple) and len(detection_result) == 2
            else detection_result
        )
        if faces is None:
            self._emit_detection_diagnostics(
                (), frame_width, frame_height, diagnostic_sink
            )
            raise NoFaceError("No usable face was detected.")

        face_rows = numpy.asarray(faces)
        if face_rows.ndim != 2 or face_rows.shape[1] != YUNET_DETECTION_VALUE_COUNT:
            raise NoFaceError("YuNet returned an invalid face detection result.")

        rows = tuple(face_rows[index] for index in range(face_rows.shape[0]))
        self._emit_detection_diagnostics(
            rows, frame_width, frame_height, diagnostic_sink
        )
        face_count = len(rows)
        if face_count == 0:
            raise NoFaceError("No usable face was detected.")
        if face_count > 1:
            raise MultipleFacesError(
                f"Expected exactly one face but detected {face_count}."
            )
        if not _valid_detection_row(rows[0]):
            raise NoFaceError("YuNet returned an invalid face detection.")
        return rows[0]

    @staticmethod
    def _emit_detection_diagnostics(
        rows: tuple[Any, ...],
        frame_width: int,
        frame_height: int,
        diagnostic_sink: DiagnosticSink | None,
    ) -> None:
        if diagnostic_sink is None:
            return
        diagnostic_sink(
            FaceDetectionDiagnostics(
                frame_width=frame_width,
                frame_height=frame_height,
                bounding_boxes=tuple(_diagnostic_box(row) for row in rows),
                confidences=tuple(float(row[14]) for row in rows),
                landmarks_valid=tuple(_valid_landmarks(row) for row in rows),
            )
        )


def _valid_landmarks(row: Any) -> bool:
    return len(row) == YUNET_DETECTION_VALUE_COUNT and all(
        math.isfinite(float(value)) for value in row[4:14]
    )


def _diagnostic_box(row: Any) -> tuple[int, int, int, int]:
    values = tuple(float(value) for value in row[:4])
    if len(values) != 4 or not all(math.isfinite(value) for value in values):
        return 0, 0, 0, 0
    x, y, width, height = values
    return tuple(int(round(value)) for value in (x, y, width, height))


def _valid_detection_row(row: Any) -> bool:
    return (
        len(row) == YUNET_DETECTION_VALUE_COUNT
        and all(math.isfinite(float(value)) for value in row)
        and float(row[2]) > 0.0
        and float(row[3]) > 0.0
        and _valid_landmarks(row)
    )
