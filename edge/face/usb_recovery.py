"""Bounded invocation of the fixed privileged camera USB recovery helper."""

from __future__ import annotations

import logging
import math
import subprocess
import threading
import time
from collections.abc import Callable
from pathlib import Path

from .errors import CameraError


logger = logging.getLogger("pi-unlock-service.camera-usb-recovery")

SUDO_EXECUTABLE = "/usr/bin/sudo"
DEFAULT_USB_RECOVERY_HELPER_PATH = Path(
    "/usr/local/sbin/smart-vending-camera-reset"
)
DEFAULT_USB_RECOVERY_TIMEOUT_SECONDS = 20.0
DEFAULT_USB_RECOVERY_COOLDOWN_SECONDS = 60.0
MAX_USB_RECOVERY_TIMEOUT_SECONDS = 60.0
MAX_USB_RECOVERY_COOLDOWN_SECONDS = 3600.0


class CameraUsbPowerRecovery:
    """Invoke one fixed no-argument helper with process-local anti-thrashing."""

    def __init__(
        self,
        helper_path: Path,
        *,
        timeout_seconds: float = DEFAULT_USB_RECOVERY_TIMEOUT_SECONDS,
        cooldown_seconds: float = DEFAULT_USB_RECOVERY_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        helper_path = Path(helper_path)
        if not helper_path.is_absolute():
            raise ValueError("Camera USB recovery helper path must be absolute.")
        if not math.isfinite(timeout_seconds) or not (
            0.1 <= timeout_seconds <= MAX_USB_RECOVERY_TIMEOUT_SECONDS
        ):
            raise ValueError(
                "Camera USB recovery timeout must be between 0.1 and "
                f"{MAX_USB_RECOVERY_TIMEOUT_SECONDS} seconds."
            )
        if not math.isfinite(cooldown_seconds) or not (
            1.0 <= cooldown_seconds <= MAX_USB_RECOVERY_COOLDOWN_SECONDS
        ):
            raise ValueError(
                "Camera USB recovery cooldown must be between 1 and "
                f"{MAX_USB_RECOVERY_COOLDOWN_SECONDS} seconds."
            )

        self.helper_path = helper_path
        self.timeout_seconds = timeout_seconds
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._last_attempt_at: float | None = None

    def __call__(self) -> None:
        if not self.helper_path.is_file():
            raise CameraError(
                "Camera USB recovery helper is unavailable.",
                reason="USB_POWER_RECOVERY_FAILURE",
            )

        with self._lock:
            now = self._clock()
            if (
                self._last_attempt_at is not None
                and now - self._last_attempt_at < self.cooldown_seconds
            ):
                logger.warning("Camera USB power recovery blocked by cooldown")
                raise CameraError(
                    "Camera USB recovery cooldown is active.",
                    reason="USB_POWER_RECOVERY_COOLDOWN",
                )

            # Record attempts before invocation so a failing helper cannot be
            # hammered by subsequent requests during the cooldown window.
            self._last_attempt_at = now
            logger.warning("Invoking fixed camera USB power recovery helper")
            try:
                subprocess.run(
                    [SUDO_EXECUTABLE, "-n", str(self.helper_path)],
                    check=True,
                    timeout=self.timeout_seconds,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    shell=False,
                )
            except subprocess.TimeoutExpired as error:
                logger.error("Camera USB power recovery helper timed out")
                raise CameraError(
                    "Camera USB recovery helper timed out.",
                    reason="USB_POWER_RECOVERY_FAILURE",
                ) from error
            except (OSError, subprocess.CalledProcessError) as error:
                logger.error(
                    "Camera USB power recovery helper failed (%s)",
                    type(error).__name__,
                )
                raise CameraError(
                    "Camera USB recovery helper failed.",
                    reason="USB_POWER_RECOVERY_FAILURE",
                ) from error

            logger.info("Camera USB power recovery helper completed")
