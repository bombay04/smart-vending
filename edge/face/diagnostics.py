"""Non-biometric diagnostics for investigating capture and crop stability."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeAlias


@dataclass(frozen=True)
class CameraCaptureDiagnostics:
    camera_index: int
    frame_width: int
    frame_height: int
    stabilization_seconds: float
    stabilization_elapsed_milliseconds: float
    stabilization_reads: int
    successful_discarded_frames: int
    post_stabilization_attempts: int


@dataclass(frozen=True)
class FaceDetectionDiagnostics:
    frame_width: int
    frame_height: int
    bounding_boxes: tuple[tuple[int, int, int, int], ...]
    normalized_crop_box: tuple[int, int, int, int] | None = None
    crop_width: int | None = None
    crop_height: int | None = None


@dataclass(frozen=True)
class RepresentationDiagnostics:
    length: int
    nonzero_values: int
    minimum: float
    maximum: float
    mean: float
    l1_norm: float
    l2_norm: float


@dataclass(frozen=True)
class SampleCollectionDiagnostics:
    phase: str
    sample_number: int
    required_samples: int
    attempt: int
    maximum_attempts: int
    status: str


@dataclass(frozen=True)
class LiveSampleDistanceDiagnostics:
    employee_code: str
    sample_number: int
    required_samples: int
    median_distance: float
    threshold: float
    passed: bool


@dataclass(frozen=True)
class ConsensusDecisionDiagnostics:
    matched: bool
    employee_code: str | None
    decision_distance: float
    threshold: float
    passed_samples: int
    required_samples: int
    reason: str


DiagnosticEvent: TypeAlias = (
    CameraCaptureDiagnostics
    | FaceDetectionDiagnostics
    | RepresentationDiagnostics
    | SampleCollectionDiagnostics
    | LiveSampleDistanceDiagnostics
    | ConsensusDecisionDiagnostics
)
DiagnosticSink: TypeAlias = Callable[[DiagnosticEvent], None]


def format_diagnostic(event: DiagnosticEvent) -> str:
    """Format aggregate diagnostics without exposing a representation vector."""

    if isinstance(event, CameraCaptureDiagnostics):
        return (
            "DEBUG camera "
            f"index={event.camera_index} "
            f"frame={event.frame_width}x{event.frame_height} "
            f"stabilizationSeconds={event.stabilization_seconds:.3f} "
            f"stabilizationElapsedMs={event.stabilization_elapsed_milliseconds:.1f} "
            f"stabilizationReads={event.stabilization_reads} "
            f"discardedFrames={event.successful_discarded_frames} "
            f"freshFrameAttempts={event.post_stabilization_attempts}"
        )

    if isinstance(event, FaceDetectionDiagnostics):
        boxes = ";".join(
            _format_bounding_box(box, event.frame_width, event.frame_height)
            for box in event.bounding_boxes
        ) or "none"
        crop = (
            f"{event.crop_width}x{event.crop_height}"
            if event.crop_width is not None and event.crop_height is not None
            else "none"
        )
        normalized_crop = (
            ",".join(str(value) for value in event.normalized_crop_box)
            if event.normalized_crop_box is not None
            else "none"
        )
        return (
            "DEBUG detection "
            f"frame={event.frame_width}x{event.frame_height} "
            f"faceCount={len(event.bounding_boxes)} boxes={boxes} "
            f"normalizedCrop={normalized_crop} crop={crop}"
        )

    if isinstance(event, RepresentationDiagnostics):
        return (
            "DEBUG representation "
            f"length={event.length} "
            f"nonzero={event.nonzero_values} "
            f"min={event.minimum:.6f} max={event.maximum:.6f} "
            f"mean={event.mean:.6f} "
            f"l1={event.l1_norm:.6f} l2={event.l2_norm:.6f}"
        )

    if isinstance(event, SampleCollectionDiagnostics):
        return (
            f"DEBUG {event.phase}Sample "
            f"sample={event.sample_number}/{event.required_samples} "
            f"attempt={event.attempt}/{event.maximum_attempts} "
            f"status={event.status}"
        )

    if isinstance(event, LiveSampleDistanceDiagnostics):
        return (
            "DEBUG liveDistance "
            f"employeeCode={event.employee_code} "
            f"sample={event.sample_number}/{event.required_samples} "
            f"medianDistance={event.median_distance:.6f} "
            f"threshold={event.threshold:.6f} passed={event.passed}"
        )

    return (
        "DEBUG consensus "
        f"matched={event.matched} employeeCode={event.employee_code or 'none'} "
        f"decisionDistance={event.decision_distance:.6f} "
        f"threshold={event.threshold:.6f} "
        f"passedSamples={event.passed_samples}/{event.required_samples} "
        f"reason={event.reason}"
    )


def _format_bounding_box(
    box: tuple[int, int, int, int], frame_width: int, frame_height: int
) -> str:
    x, y, width, height = box
    relative_x = x / frame_width if frame_width else 0.0
    relative_y = y / frame_height if frame_height else 0.0
    relative_width = width / frame_width if frame_width else 0.0
    relative_height = height / frame_height if frame_height else 0.0
    return (
        f"{x},{y},{width},{height}"
        f"({relative_x:.3f},{relative_y:.3f},"
        f"{relative_width:.3f},{relative_height:.3f})"
    )
