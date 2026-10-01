from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from edge.face.errors import CameraError
from edge.face.usb_recovery import CameraUsbPowerRecovery, SUDO_EXECUTABLE


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class CameraUsbPowerRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.helper_path = Path(self.temporary_directory.name) / "camera-reset"
        self.helper_path.touch()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def create_recovery(
        self,
        *,
        clock: FakeClock | None = None,
        cooldown_seconds: float = 60.0,
    ) -> CameraUsbPowerRecovery:
        return CameraUsbPowerRecovery(
            self.helper_path,
            timeout_seconds=12.0,
            cooldown_seconds=cooldown_seconds,
            clock=clock or FakeClock(),
        )

    def test_success_invokes_fixed_helper_without_shell_or_usb_arguments(self) -> None:
        recovery = self.create_recovery()

        with patch("edge.face.usb_recovery.subprocess.run") as run:
            recovery()

        run.assert_called_once_with(
            [SUDO_EXECUTABLE, "-n", str(self.helper_path)],
            check=True,
            timeout=12.0,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            shell=False,
        )
        arguments = run.call_args.args[0]
        self.assertNotIn("1-1.1", arguments)
        self.assertNotIn("2", arguments)
        self.assertNotIn("5258:4a55", arguments)

    def test_non_zero_helper_exit_fails_safely(self) -> None:
        recovery = self.create_recovery()
        with patch(
            "edge.face.usb_recovery.subprocess.run",
            side_effect=subprocess.CalledProcessError(1, [str(self.helper_path)]),
        ):
            with self.assertRaises(CameraError) as raised:
                recovery()
        self.assertEqual(raised.exception.reason, "USB_POWER_RECOVERY_FAILURE")

    def test_helper_timeout_fails_safely(self) -> None:
        recovery = self.create_recovery()
        with patch(
            "edge.face.usb_recovery.subprocess.run",
            side_effect=subprocess.TimeoutExpired([str(self.helper_path)], 12.0),
        ):
            with self.assertRaises(CameraError) as raised:
                recovery()
        self.assertEqual(raised.exception.reason, "USB_POWER_RECOVERY_FAILURE")

    def test_missing_helper_fails_without_invoking_sudo(self) -> None:
        recovery = CameraUsbPowerRecovery(
            Path(self.temporary_directory.name) / "missing-helper"
        )
        with patch("edge.face.usb_recovery.subprocess.run") as run:
            with self.assertRaises(CameraError) as raised:
                recovery()
        self.assertEqual(raised.exception.reason, "USB_POWER_RECOVERY_FAILURE")
        run.assert_not_called()

    def test_cooldown_cannot_be_disabled_with_zero(self) -> None:
        with self.assertRaises(ValueError):
            CameraUsbPowerRecovery(self.helper_path, cooldown_seconds=0.0)

    def test_cooldown_blocks_repeated_power_cycle(self) -> None:
        clock = FakeClock()
        recovery = self.create_recovery(clock=clock)
        with patch("edge.face.usb_recovery.subprocess.run") as run:
            recovery()
            with self.assertRaises(CameraError) as raised:
                recovery()
        self.assertEqual(raised.exception.reason, "USB_POWER_RECOVERY_COOLDOWN")
        self.assertEqual(run.call_count, 1)

    def test_cooldown_expiry_permits_later_recovery(self) -> None:
        clock = FakeClock()
        recovery = self.create_recovery(clock=clock)
        with patch("edge.face.usb_recovery.subprocess.run") as run:
            recovery()
            clock.advance(60.0)
            recovery()
        self.assertEqual(run.call_count, 2)

    def test_deployment_helper_is_fixed_no_argument_and_bounded(self) -> None:
        helper = (
            Path(__file__).resolve().parents[2]
            / "camera"
            / "smart-vending-camera-reset"
        ).read_text(encoding="utf-8")

        self.assertIn("set -eu", helper)
        self.assertIn('if [ "$#" -ne 0 ]', helper)
        self.assertIn("HUB_LOCATION=1-1.1", helper)
        self.assertIn("CAMERA_PORT=2", helper)
        self.assertIn("CAMERA_USB_ID=5258:4a55", helper)
        self.assertEqual(helper.count('-a off'), 1)
        self.assertEqual(helper.count('-a on'), 1)
        self.assertIn('while [ "$attempt" -lt 10 ]', helper)
        self.assertNotIn("$1", helper)


if __name__ == "__main__":
    unittest.main()
