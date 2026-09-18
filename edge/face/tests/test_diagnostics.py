from __future__ import annotations

import unittest

from edge.face.diagnostics import (
    ConsensusDecisionDiagnostics,
    EmbeddingDiagnostics,
    FaceDetectionDiagnostics,
    InferenceTimingDiagnostics,
    LiveSampleDistanceDiagnostics,
    format_diagnostic,
)


class DiagnosticsTests(unittest.TestCase):
    def test_detection_embedding_and_timing_diagnostics_are_aggregate_only(self) -> None:
        outputs = (
            format_diagnostic(
                FaceDetectionDiagnostics(
                    frame_width=640,
                    frame_height=480,
                    bounding_boxes=((100, 80, 200, 220),),
                    confidences=(0.99,),
                    landmarks_valid=(True,),
                )
            ),
            format_diagnostic(
                EmbeddingDiagnostics(
                    shape=(1, 128),
                    dtype="float32",
                    all_finite=True,
                    l2_norm=12.4,
                )
            ),
            format_diagnostic(
                InferenceTimingDiagnostics(
                    stage="sfaceFeature", elapsed_milliseconds=427.1
                )
            ),
        )
        combined = "\n".join(outputs)
        self.assertIn("faceCount=1", combined)
        self.assertIn("shape=1x128", combined)
        self.assertIn("elapsedMs=427.100", combined)
        self.assertNotIn("embedding=", combined)
        self.assertNotIn("[", combined)
        self.assertNotIn("]", combined)

    def test_live_distance_and_consensus_diagnostics_are_privacy_safe(self) -> None:
        outputs = (
            format_diagnostic(
                LiveSampleDistanceDiagnostics(
                    employee_code="EMP001",
                    sample_number=1,
                    required_samples=3,
                    median_distance=0.91,
                    threshold=1.128,
                    passed=True,
                )
            ),
            format_diagnostic(
                ConsensusDecisionDiagnostics(
                    matched=True,
                    employee_code="EMP001",
                    decision_distance=1.01,
                    threshold=1.128,
                    passed_samples=3,
                    required_samples=3,
                    reason="all_samples_passed",
                )
            ),
        )
        for output in outputs:
            self.assertNotIn("embedding=", output)
            self.assertNotIn("[", output)
            self.assertNotIn("]", output)


if __name__ == "__main__":
    unittest.main()
