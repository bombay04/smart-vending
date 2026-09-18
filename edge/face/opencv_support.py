"""Lazy OpenCV import so storage and matching tests remain independent."""

from __future__ import annotations

from typing import Any

from .errors import DependencyError


def require_cv2() -> Any:
    try:
        import cv2
    except ImportError as error:
        raise DependencyError(
            "OpenCV is unavailable. Install edge/requirements.txt with binary wheels."
        ) from error
    return cv2

