"""Data types shared by the face engine."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FaceTemplate:
    employee_code: str
    algorithm: str
    similarity_metric: str
    detector_model: str
    embedding_model: str
    embeddings: tuple[tuple[float, ...], ...]


@dataclass(frozen=True)
class RecognitionResult:
    matched: bool
    employee_code: str | None
    distance: float
    threshold: float
    sample_distances: tuple[float, ...]


@dataclass(frozen=True)
class CameraProbeResult:
    camera_index: int
    opened: bool
    captured_frame: bool
