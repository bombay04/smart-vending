from __future__ import annotations

import unittest

from edge.face.diagnostics import (
    CameraCaptureDiagnostics,
    ConsensusDecisionDiagnostics,
    EmbeddingDiagnostics,
    FaceDetectionDiagnostics,
    InferenceTimingDiagnostics,
    LiveSampleDistanceDiagnostics,
    format_diagnostic,
)


class DiagnosticsTests(unittest.TestCase):
    def test_camera_diagnostics_include_configuration_and_health_counts_only(self) -> None:
        output = format_diagnostic(
            CameraCaptureDiagnostics(
                camera_index=0,
                backend="V4L2",
                requested_width=640,
                requested_height=480,
                requested_fps=30,
                requested_fourcc="MJPG",
                actual_width=640,
                actual_height=480,
                actual_fps=30.0,
                actual_fourcc="MJPG",
                frame_width=640,
                frame_height=480,
                warmup_reads=3,
                unhealthy_frames=2,
                black_frames=2,
                recovery_attempt=1,
                reopen_count=1,
                time_to_first_healthy_milliseconds=42.0,
            )
        )

        self.assertIn("backend=V4L2", output)
        self.assertIn("requested=640x480@30 fourcc=MJPG", output)
        self.assertIn("blackFrames=2", output)
        self.assertIn("reopenCount=1", output)
        self.assertNotIn("pixels", output)
        self.assertNotIn("embedding", output)

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
