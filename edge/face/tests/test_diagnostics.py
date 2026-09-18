from __future__ import annotations

import unittest

from edge.face.diagnostics import (
    ConsensusDecisionDiagnostics,
    LiveSampleDistanceDiagnostics,
    RepresentationDiagnostics,
    format_diagnostic,
)


class DiagnosticsTests(unittest.TestCase):
    def test_representation_diagnostic_contains_only_aggregate_statistics(self) -> None:
        output = format_diagnostic(
            RepresentationDiagnostics(
                length=3776,
                nonzero_values=1200,
                minimum=0.0,
                maximum=0.5,
                mean=0.016949,
                l1_norm=64.0,
                l2_norm=3.0,
            )
        )
        self.assertIn("length=3776", output)
        self.assertIn("l1=64.000000", output)
        self.assertNotIn("[", output)
        self.assertNotIn("]", output)

    def test_live_distance_and_consensus_diagnostics_are_privacy_safe(self) -> None:
        outputs = (
            format_diagnostic(
                LiveSampleDistanceDiagnostics(
                    employee_code="EMP001",
                    sample_number=1,
                    required_samples=3,
                    median_distance=0.31,
                    threshold=0.35,
                    passed=True,
                )
            ),
            format_diagnostic(
                ConsensusDecisionDiagnostics(
                    matched=True,
                    employee_code="EMP001",
                    decision_distance=0.34,
                    threshold=0.35,
                    passed_samples=3,
                    required_samples=3,
                    reason="all_samples_passed",
                )
            ),
        )
        for output in outputs:
            self.assertNotIn("representation=", output)
            self.assertNotIn("[", output)
            self.assertNotIn("]", output)


if __name__ == "__main__":
    unittest.main()
