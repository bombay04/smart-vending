"""Data types shared by the face engine."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FaceTemplate:
    employee_code: str
    algorithm: str
    representations: tuple[tuple[float, ...], ...]


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
