"""SFace alignment, embedding validation, and L2 matching."""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any

import numpy

from .config import (
    DEFAULT_SFACE_MODEL_PATH,
    MAX_SFACE_L2_DISTANCE,
    SFACE_EMBEDDING_LENGTH,
)
from .diagnostics import (
    DiagnosticSink,
    EmbeddingDiagnostics,
    InferenceTimingDiagnostics,
)
from .errors import EmbeddingError, ModelError
from .opencv_support import require_cv2


def validate_embedding(embedding: Any) -> EmbeddingDiagnostics:
    """Validate official SFace output and return non-biometric metadata."""

    if embedding is None:
        raise EmbeddingError("SFace returned no embedding.")
    array = numpy.asarray(embedding)
    if array.shape != (1, SFACE_EMBEDDING_LENGTH):
        raise EmbeddingError(
            f"SFace embedding shape must be (1, {SFACE_EMBEDDING_LENGTH})."
        )
    if not numpy.issubdtype(array.dtype, numpy.floating):
        raise EmbeddingError("SFace embedding must use a floating dtype.")

    all_finite = bool(numpy.all(numpy.isfinite(array)))
    if not all_finite:
        raise EmbeddingError("SFace embedding contains non-finite values.")
    l2_norm = float(numpy.linalg.norm(array.astype(numpy.float64, copy=False)))
    if not math.isfinite(l2_norm) or l2_norm <= 0.0:
        raise EmbeddingError("SFace embedding must have a finite non-zero norm.")
    return EmbeddingDiagnostics(
        shape=tuple(int(value) for value in array.shape),
        dtype=str(array.dtype),
        all_finite=all_finite,
        l2_norm=l2_norm,
    )


class SFaceEmbedder:
    def __init__(
        self,
        model_path: Path = DEFAULT_SFACE_MODEL_PATH,
        *,
        cv2_module: Any | None = None,
    ) -> None:
        self.model_path = Path(model_path)
        if not self.model_path.is_file():
            raise ModelError(f"SFace model is missing: {self.model_path}")

        self._cv2 = cv2_module or require_cv2()
        try:
            self._recognizer = self._cv2.FaceRecognizerSF.create(
                str(self.model_path),
                "",
                self._cv2.dnn.DNN_BACKEND_OPENCV,
                self._cv2.dnn.DNN_TARGET_CPU,
            )
        except Exception as error:
            raise ModelError(
                f"SFace model could not be loaded: {self.model_path}"
            ) from error
        if self._recognizer is None:
            raise ModelError(f"SFace model could not be loaded: {self.model_path}")

    def create_embedding(
        self,
        frame: Any,
        detection: Any,
        *,
        diagnostic_sink: DiagnosticSink | None = None,
    ) -> tuple[float, ...]:
        try:
            align_started = time.perf_counter()
            aligned_face = self._recognizer.alignCrop(frame, detection)
            align_elapsed = (time.perf_counter() - align_started) * 1000.0
            feature_started = time.perf_counter()
            embedding = self._recognizer.feature(aligned_face)
            feature_elapsed = (time.perf_counter() - feature_started) * 1000.0
        except Exception as error:
            raise EmbeddingError(
                "SFace alignment or feature extraction failed."
            ) from error

        diagnostics = validate_embedding(embedding)
        if diagnostic_sink is not None:
            diagnostic_sink(
                InferenceTimingDiagnostics(
                    stage="alignCrop", elapsed_milliseconds=align_elapsed
                )
            )
            diagnostic_sink(
                InferenceTimingDiagnostics(
                    stage="sfaceFeature", elapsed_milliseconds=feature_elapsed
                )
            )
            diagnostic_sink(diagnostics)

        array = numpy.asarray(embedding).reshape(-1)
        return tuple(float(value) for value in array)

    def distance(
        self, first: tuple[float, ...], second: tuple[float, ...]
    ) -> float:
        first_feature = _feature_matrix(first)
        second_feature = _feature_matrix(second)
        try:
            distance = float(
                self._recognizer.match(
                    first_feature,
                    second_feature,
                    self._cv2.FaceRecognizerSF_FR_NORM_L2,
                )
            )
        except Exception as error:
            raise EmbeddingError("SFace L2 matching failed.") from error
        if (
            not math.isfinite(distance)
            or distance < 0.0
            or distance > MAX_SFACE_L2_DISTANCE + 1e-6
        ):
            raise EmbeddingError("SFace returned an invalid L2 distance.")
        return distance


def _feature_matrix(values: tuple[float, ...]) -> Any:
    array = numpy.asarray(values, dtype=numpy.float32).reshape(1, -1)
    validate_embedding(array)
    return array
