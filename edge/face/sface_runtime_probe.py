"""Isolated YuNet + SFace runtime gate for Raspberry Pi validation."""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy

from .camera import capture_frame
from .config import (
    DEFAULT_CAMERA_INDEX,
    DEFAULT_CAMERA_STABILIZATION_SECONDS,
    DEFAULT_SFACE_MODEL_PATH,
    DEFAULT_YUNET_MODEL_PATH,
)
from .diagnostics import EmbeddingDiagnostics
from .errors import CameraError, DependencyError, EmbeddingError
from .opencv_support import require_cv2
from .representation import validate_embedding as _validate_embedding


class RuntimeProbeError(Exception):
    """Expected, privacy-safe runtime-probe failure."""

    code = "PROBE_ERROR"


class MissingModelError(RuntimeProbeError):
    code = "MISSING_MODEL"


class ModelLoadError(RuntimeProbeError):
    code = "MODEL_LOAD_ERROR"


class InferenceError(RuntimeProbeError):
    code = "INFERENCE_ERROR"


class NoProbeFaceError(RuntimeProbeError):
    code = "NO_FACE"


class MultipleProbeFacesError(RuntimeProbeError):
    code = "MULTIPLE_FACES"


class InvalidEmbeddingError(RuntimeProbeError):
    code = "INVALID_EMBEDDING"


@dataclass(frozen=True)
class ProbeTimings:
    yunet_load_ms: float
    sface_load_ms: float
    camera_capture_ms: float
    detection_ms: float
    align_crop_ms: float
    feature_ms: float
    total_ms: float


@dataclass(frozen=True)
class ProbeResult:
    face_count: int
    embedding: EmbeddingDiagnostics
    timings: ProbeTimings


def _require_model(path: Path, label: str) -> None:
    if not path.is_file():
        raise MissingModelError(f"{label} model is missing: {path}")


def _elapsed_ms(started: float, finished: float) -> float:
    return max(0.0, (finished - started) * 1000.0)


def select_exactly_one_face(detection_result: Any) -> tuple[Any, int]:
    """Return one YuNet face row or raise a stable face-count error."""

    faces = (
        detection_result[1]
        if isinstance(detection_result, tuple) and len(detection_result) == 2
        else detection_result
    )
    if faces is None:
        raise NoProbeFaceError("YuNet detected no faces (faceCount=0).")

    face_rows = numpy.asarray(faces)
    if face_rows.ndim != 2 or face_rows.shape[1] != 15:
        raise InferenceError("YuNet returned an invalid detection result shape.")

    face_count = int(face_rows.shape[0])
    if face_count == 0:
        raise NoProbeFaceError("YuNet detected no faces (faceCount=0).")
    if face_count > 1:
        raise MultipleProbeFacesError(
            f"YuNet detected multiple faces (faceCount={face_count})."
        )
    return face_rows[0], face_count


def validate_embedding(embedding: Any) -> EmbeddingDiagnostics:
    """Translate production embedding failures into the probe's stable error."""

    try:
        return _validate_embedding(embedding)
    except EmbeddingError as error:
        raise InvalidEmbeddingError(str(error)) from error


def run_probe(
    *,
    yunet_model: Path = DEFAULT_YUNET_MODEL_PATH,
    sface_model: Path = DEFAULT_SFACE_MODEL_PATH,
    camera_index: int = DEFAULT_CAMERA_INDEX,
    stabilization_seconds: float = DEFAULT_CAMERA_STABILIZATION_SECONDS,
    cv2_module: Any | None = None,
    frame_capture: Callable[..., Any] = capture_frame,
    clock: Callable[[], float] = time.perf_counter,
) -> ProbeResult:
    """Load both models and extract metadata for one fresh camera frame."""

    total_started = clock()
    yunet_model = Path(yunet_model)
    sface_model = Path(sface_model)
    _require_model(yunet_model, "YuNet")
    _require_model(sface_model, "SFace")

    cv2 = cv2_module or require_cv2()
    try:
        backend_id = cv2.dnn.DNN_BACKEND_OPENCV
        target_id = cv2.dnn.DNN_TARGET_CPU
    except AttributeError as error:
        raise DependencyError(
            "OpenCV DNN CPU backend constants are unavailable."
        ) from error

    yunet_started = clock()
    try:
        detector = cv2.FaceDetectorYN.create(
            str(yunet_model),
            "",
            (320, 320),
            0.9,
            0.3,
            5000,
            backend_id,
            target_id,
        )
    except Exception as error:
        raise ModelLoadError(f"YuNet model could not be loaded: {yunet_model}") from error
    yunet_finished = clock()
    if detector is None:
        raise ModelLoadError(f"YuNet model could not be loaded: {yunet_model}")

    sface_started = clock()
    try:
        recognizer = cv2.FaceRecognizerSF.create(
            str(sface_model), "", backend_id, target_id
        )
    except Exception as error:
        raise ModelLoadError(f"SFace model could not be loaded: {sface_model}") from error
    sface_finished = clock()
    if recognizer is None:
        raise ModelLoadError(f"SFace model could not be loaded: {sface_model}")

    capture_started = clock()
    frame = frame_capture(
        camera_index,
        stabilization_seconds=stabilization_seconds,
    )
    capture_finished = clock()
    if frame is None or getattr(frame, "size", 0) == 0:
        raise CameraError("Camera returned an empty frame.")

    try:
        frame_height = int(frame.shape[0])
        frame_width = int(frame.shape[1])
        detector.setInputSize((frame_width, frame_height))
    except Exception as error:
        raise InferenceError("YuNet could not accept the captured frame size.") from error

    detection_started = clock()
    try:
        detection_result = detector.detect(frame)
    except Exception as error:
        raise InferenceError("YuNet detection failed.") from error
    detection_finished = clock()
    face_row, face_count = select_exactly_one_face(detection_result)

    align_started = clock()
    try:
        aligned_face = recognizer.alignCrop(frame, face_row)
    except Exception as error:
        raise InferenceError("SFace alignment failed.") from error
    align_finished = clock()

    feature_started = clock()
    try:
        embedding = recognizer.feature(aligned_face)
    except Exception as error:
        raise InferenceError("SFace feature extraction failed.") from error
    feature_finished = clock()

    embedding_diagnostics = validate_embedding(embedding)
    total_finished = clock()
    return ProbeResult(
        face_count=face_count,
        embedding=embedding_diagnostics,
        timings=ProbeTimings(
            yunet_load_ms=_elapsed_ms(yunet_started, yunet_finished),
            sface_load_ms=_elapsed_ms(sface_started, sface_finished),
            camera_capture_ms=_elapsed_ms(capture_started, capture_finished),
            detection_ms=_elapsed_ms(detection_started, detection_finished),
            align_crop_ms=_elapsed_ms(align_started, align_finished),
            feature_ms=_elapsed_ms(feature_started, feature_finished),
            total_ms=_elapsed_ms(total_started, total_finished),
        ),
    )


def format_probe_result(result: ProbeResult) -> tuple[str, str]:
    """Format privacy-safe result lines without retaining embedding values."""

    shape = "x".join(str(value) for value in result.embedding.shape)
    summary = (
        "PROBE_OK backend=OPENCV target=CPU "
        f"faceCount={result.face_count} "
        f"embeddingShape={shape} "
        f"embeddingDtype={result.embedding.dtype} "
        f"embeddingFinite={str(result.embedding.all_finite).lower()} "
        f"embeddingL2Norm={result.embedding.l2_norm:.6f}"
    )
    timings = result.timings
    timing_line = (
        "TIMING "
        f"yunetLoadMs={timings.yunet_load_ms:.3f} "
        f"sfaceLoadMs={timings.sface_load_ms:.3f} "
        f"cameraCaptureMs={timings.camera_capture_ms:.3f} "
        f"yunetDetectionMs={timings.detection_ms:.3f} "
        f"alignCropMs={timings.align_crop_ms:.3f} "
        f"sfaceFeatureMs={timings.feature_ms:.3f} "
        f"totalMs={timings.total_ms:.3f}"
    )
    return summary, timing_line


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run one privacy-safe YuNet + SFace runtime probe."
    )
    parser.add_argument("--yunet-model", type=Path, default=DEFAULT_YUNET_MODEL_PATH)
    parser.add_argument("--sface-model", type=Path, default=DEFAULT_SFACE_MODEL_PATH)
    parser.add_argument("--camera-index", type=int, default=DEFAULT_CAMERA_INDEX)
    parser.add_argument(
        "--stabilization-seconds",
        type=float,
        default=DEFAULT_CAMERA_STABILIZATION_SECONDS,
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run_probe(
            yunet_model=args.yunet_model,
            sface_model=args.sface_model,
            camera_index=args.camera_index,
            stabilization_seconds=args.stabilization_seconds,
        )
    except (RuntimeProbeError, CameraError, DependencyError) as error:
        code = getattr(error, "code", "PROBE_ERROR")
        print(f"PROBE_ERROR code={code} message={error}", file=sys.stderr)
        return 2

    for line in format_probe_result(result):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
