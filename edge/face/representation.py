"""Spatial uniform-LBP representation for prototype face matching."""

from __future__ import annotations

from typing import Any

from .config import (
    FACE_HEIGHT,
    FACE_WIDTH,
    LBP_BIN_COUNT,
    LBP_GRID_COLUMNS,
    LBP_GRID_ROWS,
    REPRESENTATION_LENGTH,
)
from .diagnostics import DiagnosticSink, RepresentationDiagnostics
from .errors import DependencyError
from .opencv_support import require_cv2


def _require_numpy() -> Any:
    try:
        import numpy
    except ImportError as error:
        raise DependencyError(
            "NumPy is unavailable. Install edge/requirements.txt with binary wheels."
        ) from error
    return numpy


def _build_uniform_lbp_lookup() -> Any:
    numpy = _require_numpy()
    lookup = numpy.empty(256, dtype=numpy.uint8)
    uniform_label = 0
    for code in range(256):
        bits = [(code >> bit) & 1 for bit in range(8)]
        transitions = sum(
            bits[index] != bits[(index + 1) % 8] for index in range(8)
        )
        if transitions <= 2:
            lookup[code] = uniform_label
            uniform_label += 1
        else:
            lookup[code] = LBP_BIN_COUNT - 1
    if uniform_label != LBP_BIN_COUNT - 1:
        raise RuntimeError("Unexpected uniform LBP lookup size.")
    return lookup


def _calculate_lbp_codes(normalized: Any) -> Any:
    numpy = _require_numpy()
    center = normalized[1:-1, 1:-1]
    neighbor_slices = (
        normalized[:-2, :-2],
        normalized[:-2, 1:-1],
        normalized[:-2, 2:],
        normalized[1:-1, 2:],
        normalized[2:, 2:],
        normalized[2:, 1:-1],
        normalized[2:, :-2],
        normalized[1:-1, :-2],
    )
    lbp_codes = numpy.zeros(center.shape, dtype=numpy.uint8)
    for bit, neighbor in enumerate(neighbor_slices):
        lbp_codes |= ((neighbor >= center).astype(numpy.uint8) << bit)
    return lbp_codes


def create_representation(
    face_grayscale: Any, *, diagnostic_sink: DiagnosticSink | None = None
) -> tuple[float, ...]:
    """Normalize one grayscale face crop into a spatial LBP histogram."""

    numpy = _require_numpy()
    cv2 = require_cv2()
    face = numpy.asarray(face_grayscale)
    if face.ndim != 2 or face.size == 0:
        raise ValueError("Face representation requires a non-empty grayscale image.")

    normalized = cv2.resize(face, (FACE_WIDTH, FACE_HEIGHT), interpolation=cv2.INTER_AREA)
    normalized = cv2.equalizeHist(normalized.astype(numpy.uint8, copy=False))

    lbp_codes = _calculate_lbp_codes(normalized)
    uniform_lbp = _build_uniform_lbp_lookup()[lbp_codes]
    histogram_parts: list[Any] = []
    for row in numpy.array_split(uniform_lbp, LBP_GRID_ROWS, axis=0):
        for cell in numpy.array_split(row, LBP_GRID_COLUMNS, axis=1):
            histogram = numpy.bincount(
                cell.ravel(), minlength=LBP_BIN_COUNT
            ).astype(numpy.float32)
            histogram /= float(histogram.sum())
            histogram_parts.append(histogram)

    representation = numpy.concatenate(histogram_parts)
    if representation.size != REPRESENTATION_LENGTH:
        raise RuntimeError("Unexpected face representation length.")
    if diagnostic_sink is not None:
        diagnostic_sink(
            RepresentationDiagnostics(
                length=int(representation.size),
                nonzero_values=int(numpy.count_nonzero(representation)),
                minimum=float(representation.min()),
                maximum=float(representation.max()),
                mean=float(representation.mean()),
                l1_norm=float(numpy.linalg.norm(representation, ord=1)),
                l2_norm=float(numpy.linalg.norm(representation, ord=2)),
            )
        )
    return tuple(float(value) for value in representation)
