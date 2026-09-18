from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from edge.face.cli import build_parser


class CliConfigurationTests(unittest.TestCase):
    def test_sface_l2_threshold_has_specific_cli_and_environment_names(self) -> None:
        with patch.dict(os.environ, {"FACE_SFACE_L2_THRESHOLD": "1.2"}):
            environment_args = build_parser().parse_args(["recognize"])
        cli_args = build_parser().parse_args(
            ["recognize", "--sface-l2-threshold", "1.05"]
        )

        self.assertEqual(environment_args.sface_l2_threshold, 1.2)
        self.assertEqual(cli_args.sface_l2_threshold, 1.05)


if __name__ == "__main__":
    unittest.main()
