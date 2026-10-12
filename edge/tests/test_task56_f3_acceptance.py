"""Non-actuating Task 56-F.3 acceptance observations."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from edge import pi_unlock_service


class FakeSerial:
    is_connected = True

    def __init__(self) -> None:
        self.commands: list[str] = []
        self.fail_before_write = False

    def open_slot(self, slot_number: int) -> None:
        if self.fail_before_write:
            raise RuntimeError("simulated interruption before Serial write")
        self.commands.append(f"OPEN:{slot_number}")


class Task56F3AcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.serial = FakeSerial()
        self.client = pi_unlock_service.app.test_client()
        self.patches = (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", self.serial),
            patch.object(pi_unlock_service, "serial_recovery", None),
        )
        for active_patch in self.patches:
            active_patch.start()
            self.addCleanup(active_patch.stop)
        with pi_unlock_service.unlock_idempotency_lock:
            self.saved_outcomes = dict(pi_unlock_service.unlock_transaction_outcomes)
            pi_unlock_service.unlock_transaction_outcomes.clear()
        self.addCleanup(self.restore_outcomes)

    def restore_outcomes(self) -> None:
        with pi_unlock_service.unlock_idempotency_lock:
            pi_unlock_service.unlock_transaction_outcomes.clear()
            pi_unlock_service.unlock_transaction_outcomes.update(self.saved_outcomes)

    def restart_process_state(self) -> None:
        # A simulated new Pi process loses this dictionary; fake external payment
        # authority and the observed Serial command log remain untouched.
        with pi_unlock_service.unlock_idempotency_lock:
            pi_unlock_service.unlock_transaction_outcomes.clear()

    def unlock(self, transaction_id: int, slot_number: int = 2):
        return self.client.post(
            "/unlock",
            json={"transactionId": transaction_id, "slotNumber": slot_number},
        )

    def test_same_process_duplicate_dispatches_one_fake_open(self) -> None:
        authority = {5601: ("SUCCESS", 2)}
        self.assertEqual(authority[5601], ("SUCCESS", 2))
        first = self.unlock(5601)
        second = self.unlock(5601)
        self.assertEqual((first.status_code, second.status_code), (200, 200))
        self.assertEqual(self.serial.commands, ["OPEN:2"])
        self.assertTrue(second.get_json()["data"]["deduplicated"])
        self.assertEqual(authority[5601], ("SUCCESS", 2))

    def test_restart_dispatches_second_fake_open_for_same_paid_transaction(self) -> None:
        authority = {5602: ("SUCCESS", 2)}
        self.assertEqual(self.unlock(5602).status_code, 200)
        self.restart_process_state()
        second = self.unlock(5602)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.get_json()["data"]["deduplicated"])
        self.assertEqual(self.serial.commands, ["OPEN:2", "OPEN:2"])
        self.assertEqual(authority[5602], ("SUCCESS", 2))

    def test_interruption_before_write_is_uncertain_until_restart(self) -> None:
        self.serial.fail_before_write = True
        first = self.unlock(5603)
        self.assertEqual(first.status_code, 500)
        self.assertEqual(self.serial.commands, [])
        uncertain = self.unlock(5603)
        self.assertEqual(uncertain.get_json()["data"]["status"], "UNLOCK_OUTCOME_UNCERTAIN")
        self.assertEqual(self.serial.commands, [])
        self.restart_process_state()
        self.serial.fail_before_write = False
        self.assertEqual(self.unlock(5603).status_code, 200)
        self.assertEqual(self.serial.commands, ["OPEN:2"])

    def test_response_lost_after_write_can_duplicate_after_restart(self) -> None:
        self.unlock(5604)  # Discard the HTTP response at the simulated client boundary.
        self.assertEqual(self.serial.commands, ["OPEN:2"])
        self.restart_process_state()
        second = self.unlock(5604)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(self.serial.commands, ["OPEN:2", "OPEN:2"])

    def test_unlock_does_not_consult_payment_authority(self) -> None:
        # The authority fixture is deliberately external to the Flask route.
        authority = {
            5610: ("PENDING", 2),
            5611: ("FAILED", 2),
            5612: ("EXPIRED", 2),
            5613: ("CANCELLED", 2),
            5614: ("SUCCESS", 2),
            5615: ("SUCCESS", 1),  # Requested slot 2 mismatches the paid slot.
        }
        baseline = authority.copy()
        for transaction_id in authority:
            with self.subTest(payment=authority[transaction_id]):
                response = self.unlock(transaction_id)
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.get_json()["data"]["deduplicated"])
        unknown = self.unlock(5616)  # No such transaction in external authority.
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(self.serial.commands, ["OPEN:2"] * 7)
        self.assertEqual(authority, baseline)
        self.assertEqual(self.unlock(5614, 3).status_code, 409)
        self.assertEqual(len(self.serial.commands), 7)


if __name__ == "__main__":
    unittest.main()
