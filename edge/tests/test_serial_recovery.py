"""USB recovery tests use only in-memory Serial and Flask test clients."""

from __future__ import annotations

import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from edge import pi_unlock_service
from edge.serial_client import Esp32SerialClient, SerialClientError
from edge.serial_recovery import SerialRecoveryManager


class FakeClock:
    def __init__(self) -> None:
        self.value = 100.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class FakeUsbSerial:
    port = "/dev/serial/by-id/test-esp32"

    def __init__(self, clock: FakeClock) -> None:
        self.clock = clock
        self.device_present = True
        self.device_name = "/dev/ttyUSB0"
        self.open_handle = False
        self.connected_device: str | None = None
        self.commands: list[str] = []
        self.reconnects: list[tuple[str, str]] = []
        self.responses: list[str] = []
        self.missing_pong = False
        self.fail_write = False
        self.fail_status_write = False
        self.fail_read = False
        self.incomplete_status = False
        self.fail_open_after_write = False
        self.status_started: threading.Event | None = None
        self.status_release: threading.Event | None = None

    @property
    def is_connected(self) -> bool:
        # A detached USB device can leave a stale, apparently open handle.
        return self.open_handle

    def connect(self) -> None:
        if not self.device_present:
            raise OSError("USB device absent")
        self.open_handle = True
        self.connected_device = self.device_name
        self.reconnects.append((self.port, self.device_name))

    def close(self) -> None:
        self.open_handle = False
        self.connected_device = None
        self.responses.clear()

    def _check_io(self) -> None:
        if (
            not self.open_handle
            or not self.device_present
            or self.connected_device != self.device_name
        ):
            raise OSError("stale USB Serial handle")

    def clear_input_buffer(self) -> None:
        self._check_io()
        self.responses.clear()

    def ping(self) -> None:
        self._check_io()
        if self.fail_write:
            raise OSError("PING write failed")
        self.commands.append("PING")
        if not self.missing_pong:
            self.responses.append("PONG")

    def get_status(self) -> None:
        self._check_io()
        if self.fail_write or self.fail_status_write:
            raise SerialClientError("GET_STATUS write failed")
        self.commands.append("GET_STATUS")
        if self.status_started is not None:
            self.status_started.set()
            assert self.status_release is not None
            if not self.status_release.wait(2):
                raise AssertionError("Status test did not release the fake Serial call")
        for slot in (1, 2, 3):
            self.responses.append(f"DOOR:{slot}:CLOSED")
            if not self.incomplete_status or slot != 3:
                self.responses.append(f"IR:{slot}:PRESENT")

    def read_line(self) -> str | None:
        self._check_io()
        self.clock.advance(0.05)
        if self.fail_read:
            raise OSError("Serial read failed")
        return self.responses.pop(0) if self.responses else None

    def parse_status_line(self, line: str):
        return Esp32SerialClient.parse_status_line(self, line)

    def open_slot(self, slot_number: int) -> None:
        self._check_io()
        if self.fail_write:
            raise OSError("OPEN write failed")
        self.commands.append(f"OPEN:{slot_number}")
        if self.fail_open_after_write:
            raise OSError("Serial write outcome uncertain")


class SerialRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.serial = FakeUsbSerial(self.clock)
        self.lock = threading.Lock()
        self.manager = SerialRecoveryManager(
            self.serial,
            self.lock,
            pi_unlock_service.collect_hardware_status,
            clock=self.clock,
        )
        self.http = pi_unlock_service.app.test_client()

    def test_serial_client_opens_configured_path_with_bounded_io(self) -> None:
        opened: list[dict[str, object]] = []

        def fake_open(**settings):
            opened.append(settings)
            return SimpleNamespace(is_open=True)

        with patch.dict("sys.modules", {"serial": SimpleNamespace(Serial=fake_open)}):
            client = Esp32SerialClient(self.serial.port, 115200, timeout=1.0)
            client.connect()

        self.assertEqual(
            opened,
            [
                {
                    "port": self.serial.port,
                    "baudrate": 115200,
                    "timeout": 1.0,
                    "write_timeout": 1.0,
                }
            ],
        )

    def wait_until(self, predicate) -> None:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.02)
        self.fail("Background Serial recovery did not reach the expected state")

    def test_background_worker_recovers_without_manual_step(self) -> None:
        self.manager.start()
        try:
            self.wait_until(lambda: self.manager.readiness()[0])
            self.serial.device_present = False
            self.clock.advance(2.1)
            self.wait_until(lambda: not self.manager.readiness()[0])
            self.serial.device_name = "/dev/ttyUSB1"
            self.serial.device_present = True
            self.clock.advance(0.5)
            self.wait_until(lambda: self.manager.readiness()[0])
            self.assertEqual(self.serial.reconnects[-1][1], "/dev/ttyUSB1")
            self.assertFalse(
                any(command.startswith("OPEN:") for command in self.serial.commands)
            )
        finally:
            self.manager.stop()

    def test_renumbered_usb_recovers_without_replaying_open(self) -> None:
        self.assertTrue(self.manager.step())
        self.assertTrue(self.manager.readiness()[0])
        self.assertEqual(self.serial.reconnects, [(self.serial.port, "/dev/ttyUSB0")])

        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", self.manager),
        ):
            self.assertEqual(self.http.get("/health").status_code, 200)
            self.assertEqual(len(self.http.get("/hardware/status").json["slots"]), 3)
            self.serial.device_present = False
            self.clock.advance(2.1)
            self.assertFalse(self.manager.step())
            self.assertEqual(self.http.get("/health").status_code, 503)
            self.assertEqual(self.http.get("/hardware/status").status_code, 503)
            denied = self.http.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 5601}
            )
            self.assertEqual(denied.status_code, 503)

            self.serial.device_name = "/dev/ttyUSB1"
            self.serial.device_present = True
            self.clock.advance(0.6)
            self.assertTrue(self.manager.step())
            self.assertEqual(self.http.get("/health").status_code, 200)
            recovered = self.http.get("/hardware/status")
            self.assertEqual(recovered.status_code, 200)
            self.assertEqual(
                recovered.json["slots"],
                [
                    {"slotNumber": slot, "doorClosed": True, "productPresent": True}
                    for slot in (1, 2, 3)
                ],
            )

        self.assertEqual(self.serial.reconnects[-1], (self.serial.port, "/dev/ttyUSB1"))
        self.assertNotIn("OPEN:1", self.serial.commands)

    def test_missing_pong_and_stale_readiness_fail_closed_with_capped_backoff(self) -> None:
        self.serial.missing_pong = True
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", self.manager),
        ):
            self.assertEqual(self.http.get("/health").status_code, 503)
        for expected_delay in (0.5, 1.0, 2.0, 4.0, 5.0):
            self.assertFalse(self.manager.step())
            self.assertFalse(self.manager.readiness()[0])
            self.assertFalse(self.serial.is_connected)
            self.assertAlmostEqual(
                self.manager._next_attempt_at - self.clock(), expected_delay
            )
            self.clock.advance(expected_delay)
        self.serial.missing_pong = False
        self.assertTrue(self.manager.step())
        self.clock.advance(6.1)
        self.assertFalse(self.manager.readiness()[0])

    def test_write_and_read_errors_invalidate_and_later_recover(self) -> None:
        self.serial.fail_write = True
        self.assertFalse(self.manager.step())
        self.serial.fail_write = False
        self.clock.advance(0.5)
        self.assertTrue(self.manager.step())
        self.serial.fail_read = True
        self.clock.advance(2.1)
        self.assertFalse(self.manager.step())
        self.assertFalse(self.manager.readiness()[0])
        self.serial.fail_read = False
        self.clock.advance(0.5)
        self.assertTrue(self.manager.step())
        self.assertEqual(len(self.serial.reconnects), 3)
        self.assertFalse(any(command.startswith("OPEN:") for command in self.serial.commands))

    def test_status_write_failure_clears_readiness_and_recovers(self) -> None:
        self.assertTrue(self.manager.step())
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", self.manager),
        ):
            self.serial.fail_status_write = True
            self.assertEqual(self.http.get("/hardware/status").status_code, 503)
            self.assertEqual(self.http.get("/health").status_code, 503)
            self.serial.fail_status_write = False
            self.clock.advance(0.5)
            self.assertTrue(self.manager.step())
            self.assertEqual(self.http.get("/hardware/status").status_code, 200)

    def test_incomplete_status_returns_no_stale_sensor_values(self) -> None:
        self.assertTrue(self.manager.step())
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", self.manager),
            patch.object(pi_unlock_service, "HARDWARE_STATUS_TIMEOUT_SECONDS", 0.05),
        ):
            self.serial.incomplete_status = True
            response = self.http.get("/hardware/status")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("slots", response.json)
            self.assertEqual(self.http.get("/health").status_code, 503)

    def test_repeated_disconnect_cycles_use_one_handle_and_no_open(self) -> None:
        self.assertTrue(self.manager.step())
        for number in (1, 2, 3):
            self.serial.device_present = False
            self.clock.advance(2.1)
            self.assertFalse(self.manager.step())
            self.serial.device_name = f"/dev/ttyUSB{number}"
            self.serial.device_present = True
            self.clock.advance(0.5)
            self.assertTrue(self.manager.step())
        self.assertEqual(len(self.serial.reconnects), 4)
        self.assertFalse(any(command.startswith("OPEN:") for command in self.serial.commands))

    def test_uncertain_unlock_is_not_replayed_after_serial_reconnect(self) -> None:
        self.assertTrue(self.manager.step())
        self.serial.fail_open_after_write = True
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", self.manager),
        ):
            first = self.http.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 5603}
            )
            self.assertEqual(first.status_code, 500)
            self.assertEqual(self.http.get("/health").status_code, 503)
            self.serial.fail_open_after_write = False
            self.clock.advance(0.5)
            self.assertTrue(self.manager.step())
            duplicate = self.http.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 5603}
            )
            self.assertTrue(duplicate.json["data"]["deduplicated"])
            self.assertEqual(
                duplicate.json["data"]["status"], "UNLOCK_OUTCOME_UNCERTAIN"
            )
        self.assertEqual(self.serial.commands.count("OPEN:1"), 1)

    def test_health_status_and_probe_share_the_serial_lock(self) -> None:
        self.assertTrue(self.manager.step())
        started = threading.Event()
        release = threading.Event()
        self.serial.status_started = started
        self.serial.status_release = release
        results: list[int] = []
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", self.manager),
        ):
            worker = threading.Thread(
                target=lambda: results.append(self.http.get("/hardware/status").status_code)
            )
            worker.start()
            self.assertTrue(started.wait(1))
            self.assertEqual(self.http.get("/health").status_code, 200)
            self.assertEqual(self.http.get("/hardware/status").status_code, 503)
            self.assertEqual(
                self.http.post(
                    "/unlock", json={"slotNumber": 2, "transactionId": 5602}
                ).status_code,
                503,
            )
            self.assertNotIn(5602, pi_unlock_service.unlock_transaction_outcomes)
            self.clock.advance(2.1)
            self.assertTrue(self.manager.step())  # Busy: no probe or handle swap.
            release.set()
            worker.join(2)
        self.assertEqual(results, [200])
        self.assertFalse(worker.is_alive())
        self.assertFalse(any(command.startswith("OPEN:") for command in self.serial.commands))

    def test_mock_mode_does_not_require_serial_or_start_recovery(self) -> None:
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", True),
            patch.object(pi_unlock_service, "serial_client", None),
            patch.object(pi_unlock_service, "serial_recovery", None),
        ):
            self.assertEqual(self.http.get("/health").json["hardware"], "mock")
            self.assertEqual(len(self.http.get("/hardware/status").json["slots"]), 3)
            self.assertEqual(
                self.http.post(
                    "/unlock", json={"slotNumber": 2, "transactionId": 5699}
                ).status_code,
                200,
            )
        self.assertEqual(self.serial.reconnects, [])
        self.assertEqual(self.serial.commands, [])


if __name__ == "__main__":
    unittest.main()
