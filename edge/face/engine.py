"""High-level registration and recognition operations."""

from __future__ import annotations

import math

from .camera import capture_frame
from .config import (
    DEFAULT_CAMERA_INDEX,
    DEFAULT_MATCH_DISTANCE_THRESHOLD,
    REPRESENTATION_ALGORITHM,
)
from .detector import HaarFaceDetector
from .matching import is_match, representation_distance
from .models import FaceTemplate, RecognitionResult
from .representation import create_representation
from .storage import TemplateStore


class FaceEngine:
    def __init__(
        self,
        *,
        camera_index: int = DEFAULT_CAMERA_INDEX,
        threshold: float = DEFAULT_MATCH_DISTANCE_THRESHOLD,
        template_store: TemplateStore | None = None,
        detector: HaarFaceDetector | None = None,
    ) -> None:
        if camera_index < 0:
            raise ValueError("camera_index must be non-negative.")
        if not math.isfinite(threshold) or not 0.0 <= threshold <= 1.0:
            raise ValueError("threshold must be a finite value from 0.0 to 1.0.")
        self.camera_index = camera_index
        self.threshold = threshold
        self.template_store = template_store or TemplateStore()
        self.detector = detector or HaarFaceDetector()

    def register(self, employee_code: str) -> FaceTemplate:
        frame = capture_frame(self.camera_index)
        face = self.detector.extract_single_face(frame)
        template = FaceTemplate(
            employee_code=employee_code,
            algorithm=REPRESENTATION_ALGORITHM,
            representation=create_representation(face),
        )
        self.template_store.save(template)
        return template

    def recognize(self) -> RecognitionResult:
        templates = self.template_store.load_all()
        frame = capture_frame(self.camera_index)
        face = self.detector.extract_single_face(frame)
        live_representation = create_representation(face)

        best_template = templates[0]
        best_distance = representation_distance(
            live_representation, best_template.representation
        )
        for template in templates[1:]:
            distance = representation_distance(
                live_representation, template.representation
            )
            if distance < best_distance:
                best_template = template
                best_distance = distance

        matched = is_match(best_distance, self.threshold)
        return RecognitionResult(
            matched=matched,
            employee_code=best_template.employee_code if matched else None,
            distance=best_distance,
            threshold=self.threshold,
        )
