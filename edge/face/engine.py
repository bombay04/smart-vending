"""High-level multi-sample registration and consensus recognition operations."""

from __future__ import annotations

import math

from .camera import capture_frame
from .config import (
    DEFAULT_CAMERA_INDEX,
    DEFAULT_CAMERA_STABILIZATION_SECONDS,
    DEFAULT_ENROLLMENT_SAMPLE_COUNT,
    DEFAULT_LIVE_SAMPLE_COUNT,
    DEFAULT_MATCH_DISTANCE_THRESHOLD,
    MAX_ATTEMPTS_PER_SAMPLE,
    MAX_CAMERA_STABILIZATION_SECONDS,
    MAX_ENROLLMENT_SAMPLE_COUNT,
    MAX_LIVE_SAMPLE_COUNT,
    MIN_ENROLLMENT_SAMPLE_COUNT,
    MIN_LIVE_SAMPLE_COUNT,
    REPRESENTATION_ALGORITHM,
)
from .detector import HaarFaceDetector
from .diagnostics import (
    ConsensusDecisionDiagnostics,
    DiagnosticEvent,
    DiagnosticSink,
    LiveSampleDistanceDiagnostics,
    SampleCollectionDiagnostics,
)
from .errors import MultipleFacesError, NoFaceError
from .matching import all_live_samples_match, is_match, median_enrollment_distance
from .models import FaceTemplate, RecognitionResult
from .representation import create_representation
from .storage import TemplateStore


def validate_sample_count(value: int, *, name: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer from {minimum} to {maximum}.")
    return value


class FaceEngine:
    def __init__(
        self,
        *,
        camera_index: int = DEFAULT_CAMERA_INDEX,
        threshold: float = DEFAULT_MATCH_DISTANCE_THRESHOLD,
        stabilization_seconds: float = DEFAULT_CAMERA_STABILIZATION_SECONDS,
        enrollment_sample_count: int = DEFAULT_ENROLLMENT_SAMPLE_COUNT,
        live_sample_count: int = DEFAULT_LIVE_SAMPLE_COUNT,
        template_store: TemplateStore | None = None,
        detector: HaarFaceDetector | None = None,
        diagnostic_sink: DiagnosticSink | None = None,
    ) -> None:
        if camera_index < 0:
            raise ValueError("camera_index must be non-negative.")
        if not math.isfinite(threshold) or not 0.0 <= threshold <= 1.0:
            raise ValueError("threshold must be a finite value from 0.0 to 1.0.")
        if not math.isfinite(stabilization_seconds) or not (
            0.0 <= stabilization_seconds <= MAX_CAMERA_STABILIZATION_SECONDS
        ):
            raise ValueError(
                "stabilization_seconds must be between 0.0 and "
                f"{MAX_CAMERA_STABILIZATION_SECONDS}."
            )
        self.enrollment_sample_count = validate_sample_count(
            enrollment_sample_count,
            name="enrollment_sample_count",
            minimum=MIN_ENROLLMENT_SAMPLE_COUNT,
            maximum=MAX_ENROLLMENT_SAMPLE_COUNT,
        )
        self.live_sample_count = validate_sample_count(
            live_sample_count,
            name="live_sample_count",
            minimum=MIN_LIVE_SAMPLE_COUNT,
            maximum=MAX_LIVE_SAMPLE_COUNT,
        )
        self.camera_index = camera_index
        self.threshold = threshold
        self.stabilization_seconds = stabilization_seconds
        self.template_store = template_store or TemplateStore()
        self.detector = detector or HaarFaceDetector()
        self.diagnostic_sink = diagnostic_sink

    def register(self, employee_code: str) -> FaceTemplate:
        representations = self._collect_representations(
            phase="enrollment", sample_count=self.enrollment_sample_count
        )
        template = FaceTemplate(
            employee_code=employee_code,
            algorithm=REPRESENTATION_ALGORITHM,
            representations=representations,
        )
        self.template_store.save(template)
        return template

    def recognize(self) -> RecognitionResult:
        templates = self.template_store.load_all()
        live_representations = self._collect_representations(
            phase="recognition", sample_count=self.live_sample_count
        )

        candidate_results: list[
            tuple[FaceTemplate, tuple[float, ...], float, bool]
        ] = []
        for template in templates:
            sample_distances = tuple(
                median_enrollment_distance(
                    live_representation, template.representations
                )
                for live_representation in live_representations
            )
            for sample_number, distance in enumerate(sample_distances, start=1):
                self._emit(
                    LiveSampleDistanceDiagnostics(
                        employee_code=template.employee_code,
                        sample_number=sample_number,
                        required_samples=self.live_sample_count,
                        median_distance=distance,
                        threshold=self.threshold,
                        passed=is_match(distance, self.threshold),
                    )
                )
            decision_distance = max(sample_distances)
            candidate_results.append(
                (
                    template,
                    sample_distances,
                    decision_distance,
                    all_live_samples_match(sample_distances, self.threshold),
                )
            )

        passing_candidates = [result for result in candidate_results if result[3]]
        best_candidate = min(candidate_results, key=lambda result: result[2])
        matched = len(passing_candidates) == 1
        selected = passing_candidates[0] if matched else best_candidate
        template, sample_distances, decision_distance, _ = selected
        passed_samples = sum(
            is_match(distance, self.threshold) for distance in sample_distances
        )
        reason = (
            "all_samples_passed"
            if matched
            else "ambiguous_candidates"
            if len(passing_candidates) > 1
            else "threshold_failure"
        )
        self._emit(
            ConsensusDecisionDiagnostics(
                matched=matched,
                employee_code=template.employee_code if matched else None,
                decision_distance=decision_distance,
                threshold=self.threshold,
                passed_samples=passed_samples,
                required_samples=self.live_sample_count,
                reason=reason,
            )
        )
        return RecognitionResult(
            matched=matched,
            employee_code=template.employee_code if matched else None,
            distance=decision_distance,
            threshold=self.threshold,
            sample_distances=sample_distances,
        )

    def _collect_representations(
        self, *, phase: str, sample_count: int
    ) -> tuple[tuple[float, ...], ...]:
        representations: list[tuple[float, ...]] = []
        for sample_number in range(1, sample_count + 1):
            for attempt in range(1, MAX_ATTEMPTS_PER_SAMPLE + 1):
                self._emit(
                    SampleCollectionDiagnostics(
                        phase=phase,
                        sample_number=sample_number,
                        required_samples=sample_count,
                        attempt=attempt,
                        maximum_attempts=MAX_ATTEMPTS_PER_SAMPLE,
                        status="capturing",
                    )
                )
                frame = capture_frame(
                    self.camera_index,
                    stabilization_seconds=self.stabilization_seconds,
                    diagnostic_sink=self.diagnostic_sink,
                )
                try:
                    face = self.detector.extract_single_face(
                        frame, diagnostic_sink=self.diagnostic_sink
                    )
                except (NoFaceError, MultipleFacesError) as error:
                    self._emit(
                        SampleCollectionDiagnostics(
                            phase=phase,
                            sample_number=sample_number,
                            required_samples=sample_count,
                            attempt=attempt,
                            maximum_attempts=MAX_ATTEMPTS_PER_SAMPLE,
                            status=error.code,
                        )
                    )
                    if attempt == MAX_ATTEMPTS_PER_SAMPLE:
                        error_type = type(error)
                        raise error_type(
                            f"Unable to collect {phase} sample {sample_number}/"
                            f"{sample_count} after {MAX_ATTEMPTS_PER_SAMPLE} "
                            f"attempts: {error}"
                        ) from error
                    continue

                representations.append(
                    create_representation(
                        face, diagnostic_sink=self.diagnostic_sink
                    )
                )
                self._emit(
                    SampleCollectionDiagnostics(
                        phase=phase,
                        sample_number=sample_number,
                        required_samples=sample_count,
                        attempt=attempt,
                        maximum_attempts=MAX_ATTEMPTS_PER_SAMPLE,
                        status="accepted",
                    )
                )
                break
        return tuple(representations)

    def _emit(self, event: DiagnosticEvent) -> None:
        if self.diagnostic_sink is not None:
            self.diagnostic_sink(event)
