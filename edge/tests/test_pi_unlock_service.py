from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

from edge.face.errors import (
    AlreadyRegisteredError,
    CameraError,
    CorruptTemplateError,
    DuplicateFaceError,
    ModelError,
    MultipleFacesError,
    NoFaceError,
)
from edge.face.models import RecognitionResult
from edge import pi_unlock_service


class StubFaceEngine:
    def __init__(
        self,
        result: RecognitionResult | None = None,
        error: Exception | None = None,
        registration_error: Exception | None = None,
        registered_codes: set[str] | None = None,
    ) -> None:
        self.result = result
        self.error = error
        self.recognize_calls = 0
        self.registration_error = registration_error
        self.register_calls: list[str] = []
        self.registered_codes = registered_codes or set()
        self.status_calls: list[str] = []
        self.remove_calls: list[str] = []

    def recognize(self) -> RecognitionResult:
        self.recognize_calls += 1
        if self.error is not None:
            raise self.error
        if self.result is None:
            raise AssertionError("StubFaceEngine requires a result or error.")
        return self.result

    def register(self, employee_code: str) -> object:
        self.register_calls.append(employee_code)
        if self.registration_error is not None:
            raise self.registration_error
        return object()

    def is_registered(self, employee_code: str) -> bool:
        self.status_calls.append(employee_code)
        return employee_code in self.registered_codes

    def remove_template(self, employee_code: str) -> bool:
        self.remove_calls.append(employee_code)
        existed = employee_code in self.registered_codes
        self.registered_codes.discard(employee_code)
        return existed


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class BlockingNoMatchEngine:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.recognize_calls = 0

    def recognize(self) -> RecognitionResult:
        self.recognize_calls += 1
        self.started.set()
        if not self.release.wait(timeout=2):
            raise AssertionError("Timed out waiting to finish the test scan.")
        return recognition_result(matched=False)


class InternalRetryNoFaceEngine:
    def __init__(self) -> None:
        self.recognize_calls = 0
        self.capture_attempts = 0

    def recognize(self) -> RecognitionResult:
        self.recognize_calls += 1
        self.capture_attempts += 3
        raise NoFaceError("No face after bounded internal retries.")


class BlockingRegistrationEngine(StubFaceEngine):
    def __init__(self) -> None:
        super().__init__(result=recognition_result(matched=True))
        self.started = threading.Event()
        self.release = threading.Event()

    def register(self, employee_code: str) -> object:
        self.register_calls.append(employee_code)
        self.started.set()
        if not self.release.wait(timeout=2):
            raise AssertionError("Timed out waiting to finish registration.")
        return object()


def recognition_result(*, matched: bool) -> RecognitionResult:
    return RecognitionResult(
        matched=matched,
        employee_code="EMP001" if matched else None,
        distance=0.437637,
        threshold=1.128,
        sample_distances=(0.31, 0.42, 0.437637),
    )


class PiUnlockServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.camera_environment_patch = patch.dict(
            "os.environ",
            {
                "FACE_CAMERA_INDEX": "0",
                "FACE_CAMERA_USB_RECOVERY_ENABLED": "false",
                "RESTOCK_UNLOCK_SECRET": "test-restock-unlock-secret-32-characters",
            },
        )
        self.camera_environment_patch.start()
        self.client = pi_unlock_service.app.test_client()
        pi_unlock_service.face_engine = None
        self.original_camera_usb_recovery = pi_unlock_service.camera_usb_recovery
        self.original_camera_usb_recovery_initialized = (
            pi_unlock_service.camera_usb_recovery_initialized
        )
        pi_unlock_service.camera_usb_recovery = None
        pi_unlock_service.camera_usb_recovery_initialized = False
        self.clock = FakeClock()
        self.original_lockout = pi_unlock_service.face_authentication_lockout
        pi_unlock_service.face_authentication_lockout = (
            pi_unlock_service.FaceAuthenticationLockout(clock=self.clock)
        )
        with pi_unlock_service.unlock_idempotency_lock:
            pi_unlock_service.unlock_transaction_outcomes.clear()
        with pi_unlock_service.restock_unlock_lock:
            pi_unlock_service.used_restock_unlock_nonces.clear()
            pi_unlock_service.restock_unlock_cycles.clear()

    def tearDown(self) -> None:
        pi_unlock_service.face_engine = None
        pi_unlock_service.camera_usb_recovery = self.original_camera_usb_recovery
        pi_unlock_service.camera_usb_recovery_initialized = (
            self.original_camera_usb_recovery_initialized
        )
        pi_unlock_service.face_authentication_lockout = self.original_lockout
        self.camera_environment_patch.stop()
        if pi_unlock_service.face_authentication_lock.locked():
            pi_unlock_service.face_authentication_lock.release()

    def post_face_authentication(self, session_id: object = 17):
        return self.client.post("/face/authenticate", json={"sessionId": session_id})

    def post_face_registration(self, employee_code: object = "EMP001"):
        return self.client.post("/face/register", json={"employeeCode": employee_code})

    def post_face_registration_status(self, employee_codes: object):
        return self.client.post(
            "/face/registration/status", json={"employeeCodes": employee_codes}
        )

    def post_face_template_remove(self, employee_code: object = "EMP001"):
        return self.client.post(
            "/face/template/remove", json={"employeeCode": employee_code}
        )

    def set_face_outcome(
        self,
        *,
        matched: bool | None = None,
        error: Exception | None = None,
    ) -> StubFaceEngine:
        result = recognition_result(matched=matched) if matched is not None else None
        engine = StubFaceEngine(result=result, error=error)
        pi_unlock_service.face_engine = engine
        return engine

    def test_match_response_contains_only_safe_decision_fields(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(recognition_result(matched=True))

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "MATCH")
        self.assertEqual(payload["employeeCode"], "EMP001")
        self.assertEqual(payload["distance"], 0.437637)
        self.assertEqual(payload["threshold"], 1.128)
        claims = pi_unlock_service.decode_authorization(payload["authorization"])
        self.assertEqual(claims["purpose"], "FACE_MATCH")
        self.assertEqual(claims["sessionId"], 17)
        self.assertEqual(claims["employeeCode"], "EMP001")
        serialized = response.get_data(as_text=True).lower()
        for forbidden in ("embedding", "template", "image", "landmark", "crop"):
            self.assertNotIn(forbidden, serialized)

    def test_no_match_returns_unauthorized_without_identity(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(recognition_result(matched=False))

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.get_json(), {"status": "NO_MATCH", "remainingAttempts": 2}
        )

    def test_no_face_remains_distinguishable(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(
            error=NoFaceError("No face detected.")
        )

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.get_json(), {"status": "NO_FACE", "remainingAttempts": 2}
        )

    def test_multiple_faces_remains_distinguishable(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(
            error=MultipleFacesError("Multiple faces detected.")
        )

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.get_json(),
            {"status": "MULTIPLE_FACES", "remainingAttempts": 2},
        )

    def test_second_counted_failure_has_one_remaining_attempt(self) -> None:
        self.set_face_outcome(matched=False)
        first_response = self.post_face_authentication()
        self.set_face_outcome(error=NoFaceError("No face detected."))
        second_response = self.post_face_authentication()

        self.assertEqual(first_response.status_code, 401)
        self.assertEqual(
            second_response.get_json(), {"status": "NO_FACE", "remainingAttempts": 1}
        )

    def test_third_counted_failure_activates_lockout(self) -> None:
        self.set_face_outcome(matched=False)
        self.post_face_authentication()
        self.set_face_outcome(error=NoFaceError("No face detected."))
        self.post_face_authentication()
        self.set_face_outcome(error=MultipleFacesError("Multiple faces detected."))

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 423)
        self.assertEqual(
            response.get_json(), {"status": "LOCKED", "retryAfterSeconds": 180}
        )

    def test_locked_request_does_not_invoke_face_engine(self) -> None:
        for _ in range(3):
            self.set_face_outcome(matched=False)
            self.post_face_authentication()
        locked_engine = self.set_face_outcome(matched=True)

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 423)
        self.assertEqual(locked_engine.recognize_calls, 0)
        self.assertGreater(response.get_json()["retryAfterSeconds"], 0)
        self.assertLessEqual(
            response.get_json()["retryAfterSeconds"],
            pi_unlock_service.LOCKOUT_DURATION_SECONDS,
        )

    def test_lockout_expiry_resets_failures_and_allows_scan(self) -> None:
        for _ in range(3):
            self.set_face_outcome(matched=False)
            self.post_face_authentication()

        self.clock.advance(180)
        ready_status = self.client.get("/face/auth/status")
        next_engine = self.set_face_outcome(matched=False)
        next_response = self.post_face_authentication()

        self.assertEqual(
            ready_status.get_json(),
            {"status": "READY", "failedAttempts": 0, "remainingAttempts": 3},
        )
        self.assertEqual(next_engine.recognize_calls, 1)
        self.assertEqual(
            next_response.get_json(), {"status": "NO_MATCH", "remainingAttempts": 2}
        )

    def test_status_endpoint_is_not_cacheable(self) -> None:
        response = self.client.get("/face/auth/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_match_resets_previous_failures(self) -> None:
        self.set_face_outcome(matched=False)
        self.post_face_authentication()
        self.set_face_outcome(error=NoFaceError("No face detected."))
        self.post_face_authentication()
        self.set_face_outcome(matched=True)

        match_response = self.post_face_authentication()
        status_response = self.client.get("/face/auth/status")

        self.assertEqual(match_response.status_code, 200)
        self.assertEqual(
            status_response.get_json(),
            {"status": "READY", "failedAttempts": 0, "remainingAttempts": 3},
        )

    def test_concurrent_scan_returns_busy_without_running_engine(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(recognition_result(matched=True))
        self.assertTrue(pi_unlock_service.face_authentication_lock.acquire(blocking=False))

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"status": "BUSY"})
        self.assertEqual(
            self.client.get("/face/auth/status").get_json()["failedAttempts"], 0
        )

    def test_concurrency_cannot_bypass_third_failure_lockout(self) -> None:
        for _ in range(2):
            self.set_face_outcome(matched=False)
            self.post_face_authentication()

        blocking_engine = BlockingNoMatchEngine()
        pi_unlock_service.face_engine = blocking_engine
        response_holder: list[tuple[int, dict[str, object]]] = []

        def finish_third_failure() -> None:
            with pi_unlock_service.app.test_client() as thread_client:
                response = thread_client.post(
                    "/face/authenticate", json={"sessionId": 17}
                )
                response_holder.append((response.status_code, response.get_json()))

        request_thread = threading.Thread(target=finish_third_failure)
        request_thread.start()
        self.assertTrue(blocking_engine.started.wait(timeout=2))

        busy_response = self.post_face_authentication()
        blocking_engine.release.set()
        request_thread.join(timeout=2)
        self.assertFalse(request_thread.is_alive())

        after_lockout_response = self.post_face_authentication()
        self.assertEqual(busy_response.status_code, 409)
        self.assertEqual(response_holder[0][0], 423)
        self.assertEqual(after_lockout_response.status_code, 423)
        self.assertEqual(blocking_engine.recognize_calls, 1)

    def test_runtime_failure_returns_safe_unavailable_response(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(
            error=CameraError("Sensitive camera detail.")
        )

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {
                "status": "UNAVAILABLE",
                "error": "Face authentication service is unavailable.",
            },
        )
        self.assertNotIn("Sensitive", response.get_data(as_text=True))
        self.assertEqual(
            self.client.get("/face/auth/status").get_json()["failedAttempts"], 0
        )

    def test_camera_open_read_and_black_failures_return_unavailable(self) -> None:
        for reason in (
            "OPEN_FAILURE",
            "READ_FAILURE",
            "BLACK_FRAME",
            "NEAR_BLACK_FRAME",
        ):
            with self.subTest(reason=reason):
                self.set_face_outcome(
                    error=CameraError("sensitive camera detail", reason=reason)
                )

                response = self.post_face_authentication()

                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.get_json()["status"], "UNAVAILABLE")
                self.assertEqual(
                    self.client.get("/face/auth/status").get_json()[
                        "failedAttempts"
                    ],
                    0,
                )

    def test_camera_failure_after_two_failures_does_not_activate_lockout(self) -> None:
        for _ in range(2):
            self.set_face_outcome(matched=False)
            self.post_face_authentication()
        self.set_face_outcome(
            error=CameraError("dead stream", reason="NEAR_BLACK_FRAME")
        )

        response = self.post_face_authentication()
        status = self.client.get("/face/auth/status")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "UNAVAILABLE")
        self.assertEqual(
            status.get_json(),
            {"status": "READY", "failedAttempts": 2, "remainingAttempts": 1},
        )

    def test_internal_error_does_not_count(self) -> None:
        self.set_face_outcome(error=RuntimeError("Unexpected sensitive failure."))

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            self.client.get("/face/auth/status").get_json()["failedAttempts"], 0
        )

    def test_internal_capture_retries_count_as_one_http_failure(self) -> None:
        engine = InternalRetryNoFaceEngine()
        pi_unlock_service.face_engine = engine

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(engine.recognize_calls, 1)
        self.assertEqual(engine.capture_attempts, 3)
        self.assertEqual(
            self.client.get("/face/auth/status").get_json(),
            {"status": "READY", "failedAttempts": 1, "remainingAttempts": 2},
        )

    def test_model_initialization_failure_returns_unavailable(self) -> None:
        with patch.object(
            pi_unlock_service,
            "FaceEngine",
            side_effect=ModelError("Sensitive model path."),
        ):
            response = self.post_face_authentication()

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "UNAVAILABLE")
        self.assertNotIn("Sensitive", response.get_data(as_text=True))
        self.assertIsNone(pi_unlock_service.face_engine)

    def test_runtime_is_initialized_once_and_reused(self) -> None:
        engine = StubFaceEngine(recognition_result(matched=True))
        with patch.object(pi_unlock_service, "FaceEngine", return_value=engine) as factory:
            first_response = self.post_face_authentication()
            second_response = self.post_face_authentication()

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        factory.assert_called_once_with(
            camera_index=0,
            camera_recovery_escalation=None,
        )

    def test_camera_index_is_server_configured(self) -> None:
        engine = StubFaceEngine(recognition_result(matched=True))
        with (
            patch.dict("os.environ", {"FACE_CAMERA_INDEX": "4"}),
            patch.object(pi_unlock_service, "FaceEngine", return_value=engine) as factory,
        ):
            response = self.post_face_authentication()

        self.assertEqual(response.status_code, 200)
        factory.assert_called_once_with(
            camera_index=4,
            camera_recovery_escalation=None,
        )

    def test_camera_usb_recovery_is_disabled_by_default(self) -> None:
        with patch.object(pi_unlock_service, "CameraUsbPowerRecovery") as factory:
            recovery = pi_unlock_service.get_camera_usb_recovery()

        self.assertIsNone(recovery)
        factory.assert_not_called()

    def test_enabled_camera_usb_recovery_is_configured_once(self) -> None:
        recovery = object()
        with (
            patch.dict(
                "os.environ",
                {
                    "FACE_CAMERA_USB_RECOVERY_ENABLED": "true",
                    "FACE_CAMERA_USB_RECOVERY_HELPER": "/fixed/camera-reset",
                    "FACE_CAMERA_USB_RECOVERY_TIMEOUT_SECONDS": "15",
                    "FACE_CAMERA_USB_RECOVERY_COOLDOWN_SECONDS": "90",
                },
            ),
            patch.object(
                pi_unlock_service,
                "CameraUsbPowerRecovery",
                return_value=recovery,
            ) as factory,
        ):
            first = pi_unlock_service.get_camera_usb_recovery()
            second = pi_unlock_service.get_camera_usb_recovery()

        self.assertIs(first, recovery)
        self.assertIs(second, recovery)
        factory.assert_called_once_with(
            Path("/fixed/camera-reset"),
            timeout_seconds=15.0,
            cooldown_seconds=90.0,
        )

    def test_enabled_recovery_callable_is_wired_into_face_engine(self) -> None:
        engine = StubFaceEngine(recognition_result(matched=True))
        recovery = object()
        with (
            patch.object(
                pi_unlock_service,
                "get_camera_usb_recovery",
                return_value=recovery,
            ),
            patch.object(pi_unlock_service, "FaceEngine", return_value=engine) as factory,
        ):
            response = self.post_face_authentication()

        self.assertEqual(response.status_code, 200)
        factory.assert_called_once_with(
            camera_index=0,
            camera_recovery_escalation=recovery,
        )

    def test_camera_status_ready_contains_no_biometric_data(self) -> None:
        with patch.object(pi_unlock_service, "capture_frame", return_value=object()) as capture:
            response = self.client.get("/camera/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "READY"})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        capture.assert_called_once_with(0, recovery_escalation=None)
        serialized = response.get_data(as_text=True).lower()
        for forbidden in (
            "embedding",
            "distance",
            "threshold",
            "template",
            "image",
            "landmark",
            "crop",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_enabled_recovery_callable_is_wired_into_camera_status(self) -> None:
        recovery = object()
        with (
            patch.object(
                pi_unlock_service,
                "get_camera_usb_recovery",
                return_value=recovery,
            ),
            patch.object(
                pi_unlock_service, "capture_frame", return_value=object()
            ) as capture,
        ):
            response = self.client.get("/camera/status")

        self.assertEqual(response.status_code, 200)
        capture.assert_called_once_with(0, recovery_escalation=recovery)

    def test_camera_status_reports_safe_unhealthy_frame_reason(self) -> None:
        for reason in ("BLACK_FRAME", "NEAR_BLACK_FRAME"):
            with self.subTest(reason=reason):
                with patch.object(
                    pi_unlock_service,
                    "capture_frame",
                    side_effect=CameraError("sensitive detail", reason=reason),
                ):
                    response = self.client.get("/camera/status")

                self.assertEqual(response.status_code, 503)
                self.assertEqual(
                    response.get_json(),
                    {"status": "UNAVAILABLE", "reason": reason},
                )
                self.assertNotIn(
                    "sensitive", response.get_data(as_text=True).lower()
                )

    def test_camera_status_does_not_change_authentication_failures(self) -> None:
        self.set_face_outcome(matched=False)
        self.post_face_authentication()

        with patch.object(
            pi_unlock_service,
            "capture_frame",
            side_effect=CameraError("read failed", reason="READ_FAILURE"),
        ):
            self.client.get("/camera/status")

        self.assertEqual(
            self.client.get("/face/auth/status").get_json(),
            {"status": "READY", "failedAttempts": 1, "remainingAttempts": 2},
        )

    def test_failure_and_lockout_responses_contain_no_biometric_material(self) -> None:
        responses = []
        for _ in range(3):
            self.set_face_outcome(matched=False)
            responses.append(self.post_face_authentication())
        responses.append(self.post_face_authentication())

        for response in responses:
            serialized = response.get_data(as_text=True).lower()
            for forbidden in (
                "embedding",
                "distance",
                "threshold",
                "template",
                "image",
                "landmark",
            ):
                self.assertNotIn(forbidden, serialized)

    def test_successful_registration_normalizes_code_and_returns_safe_fields(self) -> None:
        engine = StubFaceEngine(result=recognition_result(matched=True))
        pi_unlock_service.face_engine = engine

        response = self.post_face_registration("  emp001  ")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(), {"status": "REGISTERED", "employeeCode": "EMP001"}
        )
        self.assertEqual(engine.register_calls, ["EMP001"])
        serialized = response.get_data(as_text=True).lower()
        for forbidden in ("embedding", "template", "image", "landmark", "crop"):
            self.assertNotIn(forbidden, serialized)

    def test_registration_rejects_invalid_employee_code_without_camera_use(self) -> None:
        engine = StubFaceEngine(result=recognition_result(matched=True))
        pi_unlock_service.face_engine = engine

        for employee_code in ("", "bad code", 123, None):
            response = self.post_face_registration(employee_code)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["status"], "INVALID_REQUEST")

        self.assertEqual(engine.register_calls, [])

    def test_registration_returns_expected_retryable_capture_statuses(self) -> None:
        for error, expected_status in (
            (NoFaceError("sensitive"), "NO_FACE"),
            (MultipleFacesError("sensitive"), "MULTIPLE_FACES"),
        ):
            pi_unlock_service.face_engine = StubFaceEngine(
                result=recognition_result(matched=True), registration_error=error
            )
            response = self.post_face_registration()
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.get_json(), {"status": expected_status})
            self.assertNotIn("sensitive", response.get_data(as_text=True))

    def test_registration_does_not_overwrite_existing_template(self) -> None:
        engine = StubFaceEngine(
            result=recognition_result(matched=True),
            registration_error=AlreadyRegisteredError("already exists"),
        )
        pi_unlock_service.face_engine = engine

        response = self.post_face_registration()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"status": "ALREADY_REGISTERED"})

    def test_duplicate_face_returns_structured_conflict_without_biometric_data(self) -> None:
        engine = StubFaceEngine(
            result=recognition_result(matched=True),
            registration_error=DuplicateFaceError("EMP037"),
        )
        pi_unlock_service.face_engine = engine

        response = self.post_face_registration("EMP051")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.get_json(),
            {
                "error": "This face is already registered to another employee.",
                "code": "FACE_ALREADY_REGISTERED",
                "conflictingEmployeeCode": "EMP037",
            },
        )
        serialized = response.get_data(as_text=True).lower()
        for forbidden in ("embedding", "distance", "threshold", "template", "image"):
            self.assertNotIn(forbidden, serialized)

    def test_duplicate_scan_infrastructure_failure_is_not_reported_as_conflict(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(
            result=recognition_result(matched=True),
            registration_error=CorruptTemplateError("sensitive local path"),
        )

        response = self.post_face_registration("EMP051")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "UNAVAILABLE")
        self.assertNotIn("FACE_ALREADY_REGISTERED", response.get_data(as_text=True))

    def test_registration_never_changes_authentication_failures_or_lockout(self) -> None:
        self.set_face_outcome(matched=False)
        self.post_face_authentication()
        before = self.client.get("/face/auth/status").get_json()
        pi_unlock_service.face_engine = StubFaceEngine(
            result=recognition_result(matched=True),
            registration_error=NoFaceError("no face"),
        )

        self.post_face_registration()
        after = self.client.get("/face/auth/status").get_json()

        self.assertEqual(before, after)
        self.assertEqual(after["failedAttempts"], 1)

    def test_registration_does_not_clear_an_active_authentication_lockout(self) -> None:
        for _ in range(3):
            self.set_face_outcome(matched=False)
            self.post_face_authentication()
        pi_unlock_service.face_engine = StubFaceEngine(
            result=recognition_result(matched=True)
        )

        registration_response = self.post_face_registration()
        status_response = self.client.get("/face/auth/status")
        authentication_response = self.post_face_authentication()

        self.assertEqual(registration_response.status_code, 200)
        self.assertEqual(status_response.get_json()["status"], "LOCKED")
        self.assertEqual(authentication_response.status_code, 423)

    def test_registered_employee_uses_existing_authentication_endpoint(self) -> None:
        engine = StubFaceEngine(result=recognition_result(matched=True))
        pi_unlock_service.face_engine = engine

        registration_response = self.post_face_registration()
        authentication_response = self.post_face_authentication()

        self.assertEqual(registration_response.status_code, 200)
        self.assertEqual(authentication_response.status_code, 200)
        self.assertEqual(authentication_response.get_json()["employeeCode"], "EMP001")
        self.assertEqual(engine.register_calls, ["EMP001"])
        self.assertEqual(engine.recognize_calls, 1)

    def test_registration_and_authentication_share_camera_mutex(self) -> None:
        engine = BlockingRegistrationEngine()
        pi_unlock_service.face_engine = engine
        response_holder: list[int] = []

        def register() -> None:
            with pi_unlock_service.app.test_client() as thread_client:
                response_holder.append(
                    thread_client.post(
                        "/face/register", json={"employeeCode": "EMP001"}
                    ).status_code
                )

        request_thread = threading.Thread(target=register)
        request_thread.start()
        self.assertTrue(engine.started.wait(timeout=2))

        authentication_response = self.post_face_authentication()
        second_registration_response = self.post_face_registration("EMP002")
        engine.release.set()
        request_thread.join(timeout=2)

        self.assertEqual(authentication_response.status_code, 409)
        self.assertEqual(authentication_response.get_json(), {"status": "BUSY"})
        self.assertEqual(second_registration_response.status_code, 409)
        self.assertEqual(second_registration_response.get_json(), {"status": "BUSY"})
        self.assertEqual(response_holder, [200])
        self.assertEqual(engine.recognize_calls, 0)

    def test_registration_status_reports_only_existence_for_known_and_unknown_codes(
        self,
    ) -> None:
        engine = StubFaceEngine(
            result=recognition_result(matched=True), registered_codes={"EMP001"}
        )
        pi_unlock_service.face_engine = engine

        response = self.post_face_registration_status(
            ["emp001", " EMP002 ", "EMP999"]
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(
            response.get_json(),
            {
                "status": "OK",
                "employees": [
                    {"employeeCode": "EMP001", "registered": True},
                    {"employeeCode": "EMP002", "registered": False},
                    {"employeeCode": "EMP999", "registered": False},
                ],
            },
        )
        self.assertEqual(engine.status_calls, ["EMP001", "EMP002", "EMP999"])
        serialized = response.get_data(as_text=True).lower()
        for forbidden in (
            "embedding",
            "template",
            "image",
            "landmark",
            "path",
            "model",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_registration_status_rejects_malformed_requests(self) -> None:
        engine = StubFaceEngine(result=recognition_result(matched=True))
        pi_unlock_service.face_engine = engine

        for employee_codes in ([], ["bad code"], [123], "EMP001"):
            response = self.post_face_registration_status(employee_codes)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["status"], "INVALID_REQUEST")

        self.assertEqual(engine.status_calls, [])

    def test_registration_status_does_not_change_authentication_failures(self) -> None:
        self.set_face_outcome(matched=False)
        self.post_face_authentication()
        engine = StubFaceEngine(
            result=recognition_result(matched=True), registered_codes={"EMP001"}
        )
        pi_unlock_service.face_engine = engine

        self.post_face_registration_status(["EMP001"])

        self.assertEqual(
            self.client.get("/face/auth/status").get_json(),
            {"status": "READY", "failedAttempts": 1, "remainingAttempts": 2},
        )

    def test_template_removal_is_metadata_only_and_idempotent(self) -> None:
        engine = StubFaceEngine(
            result=recognition_result(matched=True), registered_codes={"EMP001"}
        )
        pi_unlock_service.face_engine = engine

        removed = self.post_face_template_remove(" emp001 ")
        absent = self.post_face_template_remove("EMP001")

        self.assertEqual(removed.status_code, 200)
        self.assertEqual(
            removed.get_json(),
            {
                "status": "REMOVED",
                "employeeCode": "EMP001",
                "templateExisted": True,
                "removed": True,
            },
        )
        self.assertEqual(
            absent.get_json(),
            {
                "status": "ABSENT",
                "employeeCode": "EMP001",
                "templateExisted": False,
                "removed": False,
            },
        )
        self.assertEqual(engine.remove_calls, ["EMP001", "EMP001"])
        serialized = removed.get_data(as_text=True).lower()
        for forbidden in ("embedding", "image", "landmark", "path", "model"):
            self.assertNotIn(forbidden, serialized)

    def test_template_removal_rejects_invalid_codes_and_traversal(self) -> None:
        engine = StubFaceEngine(result=recognition_result(matched=True))
        pi_unlock_service.face_engine = engine

        for employee_code in ("", "../EMP001", "EMP/001", 123, None):
            response = self.post_face_template_remove(employee_code)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.get_json()["status"], "INVALID_REQUEST")
        self.assertEqual(engine.remove_calls, [])

        extra_field = self.client.post(
            "/face/template/remove",
            json={"employeeCode": "EMP001", "path": "../face/data/EMP001.json"},
        )
        self.assertEqual(extra_field.status_code, 400)
        self.assertEqual(engine.remove_calls, [])

    def test_template_status_and_removal_share_the_face_operation_mutex(self) -> None:
        engine = StubFaceEngine(
            result=recognition_result(matched=True), registered_codes={"EMP001"}
        )
        pi_unlock_service.face_engine = engine
        self.assertTrue(pi_unlock_service.face_authentication_lock.acquire(blocking=False))

        status_response = self.post_face_registration_status(["EMP001"])
        removal_response = self.post_face_template_remove("EMP001")

        self.assertEqual(status_response.status_code, 409)
        self.assertEqual(status_response.get_json(), {"status": "BUSY"})
        self.assertEqual(removal_response.status_code, 409)
        self.assertEqual(removal_response.get_json(), {"status": "BUSY"})
        self.assertEqual(engine.status_calls, [])
        self.assertEqual(engine.remove_calls, [])

    def test_mock_unlock_and_status_endpoints_still_work(self) -> None:
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            status_response = self.client.get("/hardware/status")
            unlock_response = self.client.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 81}
            )

        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(len(status_response.get_json()["slots"]), 3)
        self.assertEqual(unlock_response.status_code, 200)
        self.assertEqual(
            unlock_response.get_json()["data"]["status"], "UNLOCK_COMMAND_SENT"
        )
        self.assertFalse(unlock_response.get_json()["data"]["deduplicated"])

    def test_unlock_requires_a_positive_transaction_id(self) -> None:
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            missing = self.client.post("/unlock", json={"slotNumber": 1})
            invalid = self.client.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 0}
            )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(invalid.status_code, 400)

    def test_duplicate_transaction_unlock_is_suppressed(self) -> None:
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            first = self.client.post(
                "/unlock", json={"slotNumber": 2, "transactionId": 82}
            )
            duplicate = self.client.post(
                "/unlock", json={"slotNumber": 2, "transactionId": 82}
            )
            wrong_slot = self.client.post(
                "/unlock", json={"slotNumber": 3, "transactionId": 82}
            )

        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.get_json()["data"]["deduplicated"])
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.get_json()["data"]["status"], "ALREADY_UNLOCKED")
        self.assertTrue(duplicate.get_json()["data"]["deduplicated"])
        self.assertEqual(wrong_slot.status_code, 409)

    def test_real_hardware_duplicate_opens_the_slot_once(self) -> None:
        class StubSerialClient:
            is_connected = True

            def __init__(self) -> None:
                self.opened_slots: list[int] = []

            def open_slot(self, slot_number: int) -> None:
                self.opened_slots.append(slot_number)

        serial = StubSerialClient()
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
        ):
            first = self.client.post(
                "/unlock", json={"slotNumber": 3, "transactionId": 83}
            )
            duplicate = self.client.post(
                "/unlock", json={"slotNumber": 3, "transactionId": 83}
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(serial.opened_slots, [3])
        self.assertTrue(duplicate.get_json()["data"]["deduplicated"])

    def test_uncertain_hardware_outcome_is_not_retried(self) -> None:
        class FailingSerialClient:
            is_connected = True

            def __init__(self) -> None:
                self.open_calls = 0

            def open_slot(self, _slot_number: int) -> None:
                self.open_calls += 1
                raise RuntimeError("outcome unknown")

        serial = FailingSerialClient()
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
        ):
            first = self.client.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 84}
            )
            duplicate = self.client.post(
                "/unlock", json={"slotNumber": 1, "transactionId": 84}
            )

        self.assertEqual(first.status_code, 500)
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(serial.open_calls, 1)
        self.assertEqual(
            duplicate.get_json()["data"]["status"], "UNLOCK_OUTCOME_UNCERTAIN"
        )
        self.assertTrue(duplicate.get_json()["data"]["deduplicated"])

    def restock_authorization(
        self, slot_number: int, *, expires_at: int | None = None, nonce: str = "nonce-1234567890"
    ) -> str:
        authorization = pi_unlock_service.encode_authorization(
            {
                "v": 1,
                "purpose": "RESTOCK_UNLOCK",
                "machineId": "PILOT_KIOSK",
                "sessionId": 17,
                "employeeId": 4,
                "slotNumber": slot_number,
                "expiresAt": expires_at or int(pi_unlock_service.time.time() * 1000) + 10_000,
                "nonce": nonce,
            }
        )
        self.assertIsNotNone(authorization)
        return authorization

    def test_restock_unlock_opens_only_the_authorized_slot(self) -> None:
        class StubSerialClient:
            is_connected = True

            def __init__(self) -> None:
                self.opened_slots: list[int] = []

            def open_slot(self, slot_number: int) -> None:
                self.opened_slots.append(slot_number)

        serial = StubSerialClient()
        authorization = self.restock_authorization(2)
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
            patch.object(
                pi_unlock_service,
                "read_fresh_hardware_status_locked",
                return_value=[
                    {
                        "slotNumber": number,
                        "productPresent": True,
                        "doorClosed": True,
                    }
                    for number in (1, 2, 3)
                ],
            ),
        ):
            response = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 2, "authorization": authorization},
            )
            wrong_slot = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 1, "authorization": authorization},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(serial.opened_slots, [2])
        self.assertEqual(wrong_slot.status_code, 403)

    def test_restock_unlock_rejects_open_door_without_solenoid_activation(self) -> None:
        class StubSerialClient:
            is_connected = True

            def __init__(self) -> None:
                self.opened_slots: list[int] = []

            def open_slot(self, slot_number: int) -> None:
                self.opened_slots.append(slot_number)

        serial = StubSerialClient()
        authorization = self.restock_authorization(1)
        slots = [
            {
                "slotNumber": number,
                "productPresent": True,
                "doorClosed": number != 1,
            }
            for number in (1, 2, 3)
        ]
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
            patch.object(
                pi_unlock_service,
                "read_fresh_hardware_status_locked",
                return_value=slots,
            ) as sensor_read,
        ):
            response = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 1, "authorization": authorization},
            )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(serial.opened_slots, [])
        sensor_read.assert_called_once_with()

    def test_restock_unlock_rejects_unknown_or_failed_sensor_read(self) -> None:
        class StubSerialClient:
            is_connected = True

            def __init__(self) -> None:
                self.opened_slots: list[int] = []

            def open_slot(self, slot_number: int) -> None:
                self.opened_slots.append(slot_number)

        serial = StubSerialClient()
        authorization = self.restock_authorization(2)
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
            patch.object(
                pi_unlock_service,
                "read_fresh_hardware_status_locked",
                side_effect=pi_unlock_service.SerialClientError("sensor timeout"),
            ),
        ):
            response = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 2, "authorization": authorization},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(serial.opened_slots, [])

        unknown_authorization = self.restock_authorization(
            2, nonce="unknown-sensor-123456"
        )
        unknown_slots = [
            {
                "slotNumber": number,
                "productPresent": True,
                "doorClosed": None if number == 2 else True,
            }
            for number in (1, 2, 3)
        ]
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
            patch.object(
                pi_unlock_service,
                "read_fresh_hardware_status_locked",
                return_value=unknown_slots,
            ),
        ):
            unknown = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 2, "authorization": unknown_authorization},
            )

        self.assertEqual(unknown.status_code, 503)
        self.assertEqual(serial.opened_slots, [])

    def test_restock_unlock_requires_open_then_closed_before_same_slot_reuse(self) -> None:
        def slots(door_closed: bool):
            return [
                {
                    "slotNumber": number,
                    "productPresent": True,
                    "doorClosed": door_closed if number == 1 else True,
                }
                for number in (1, 2, 3)
            ]

        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            first = self.client.post(
                "/restock/unlock",
                json={
                    "slotNumber": 1,
                    "authorization": self.restock_authorization(1, nonce="cycle-first-123456"),
                },
            )
            still_closed = self.client.post(
                "/restock/unlock",
                json={
                    "slotNumber": 1,
                    "authorization": self.restock_authorization(1, nonce="cycle-second-12345"),
                },
            )
            pi_unlock_service.observe_restock_door_cycles(slots(False))
            pi_unlock_service.observe_restock_door_cycles(slots(True))
            after_cycle = self.client.post(
                "/restock/unlock",
                json={
                    "slotNumber": 1,
                    "authorization": self.restock_authorization(1, nonce="cycle-third-123456"),
                },
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(still_closed.status_code, 409)
        self.assertEqual(after_cycle.status_code, 200)

    def test_concurrent_same_slot_restock_requests_send_one_solenoid_command(self) -> None:
        class BlockingSerialClient:
            is_connected = True

            def __init__(self) -> None:
                self.started = threading.Event()
                self.release = threading.Event()
                self.opened_slots: list[int] = []

            def open_slot(self, slot_number: int) -> None:
                self.opened_slots.append(slot_number)
                self.started.set()
                if not self.release.wait(timeout=2):
                    raise AssertionError("Timed out waiting to release solenoid command")

        serial = BlockingSerialClient()
        statuses: list[int] = []

        def request_unlock(nonce: str) -> None:
            with pi_unlock_service.app.test_client() as thread_client:
                response = thread_client.post(
                    "/restock/unlock",
                    json={
                        "slotNumber": 1,
                        "authorization": self.restock_authorization(1, nonce=nonce),
                    },
                )
                statuses.append(response.status_code)

        closed_slots = [
            {"slotNumber": number, "productPresent": True, "doorClosed": True}
            for number in (1, 2, 3)
        ]
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", False),
            patch.object(pi_unlock_service, "serial_client", serial),
            patch.object(
                pi_unlock_service,
                "read_fresh_hardware_status_locked",
                return_value=closed_slots,
            ),
        ):
            first = threading.Thread(target=request_unlock, args=("concurrent-first-123",))
            second = threading.Thread(target=request_unlock, args=("concurrent-second-12",))
            first.start()
            self.assertTrue(serial.started.wait(timeout=2))
            second.start()
            serial.release.set()
            first.join(timeout=2)
            second.join(timeout=2)

        self.assertEqual(sorted(statuses), [200, 409])
        self.assertEqual(serial.opened_slots, [1])

    def test_one_pending_slot_does_not_block_another_safe_slot(self) -> None:
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            first = self.client.post(
                "/restock/unlock",
                json={
                    "slotNumber": 1,
                    "authorization": self.restock_authorization(1, nonce="slot-one-123456789"),
                },
            )
            second = self.client.post(
                "/restock/unlock",
                json={
                    "slotNumber": 2,
                    "authorization": self.restock_authorization(2, nonce="slot-two-123456789"),
                },
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)

    def test_restock_unlock_fails_closed_for_missing_or_incorrect_secret(self) -> None:
        valid = self.restock_authorization(1)
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", True),
            patch.dict("os.environ", {"RESTOCK_UNLOCK_SECRET": ""}),
        ):
            missing = self.client.post(
                "/restock/unlock", json={"slotNumber": 1, "authorization": valid}
            )
        with (
            patch.object(pi_unlock_service, "MOCK_HARDWARE", True),
            patch.dict(
                "os.environ",
                {"RESTOCK_UNLOCK_SECRET": "different-restock-unlock-secret-32-chars"},
            ),
        ):
            incorrect = self.client.post(
                "/restock/unlock", json={"slotNumber": 1, "authorization": valid}
            )

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(incorrect.status_code, 403)

    def test_restock_unlock_rejects_expired_tampered_and_replayed_grants(self) -> None:
        valid = self.restock_authorization(1)
        expired = self.restock_authorization(
            1,
            expires_at=int(pi_unlock_service.time.time() * 1000) - 1,
            nonce="expired-1234567890",
        )
        overlong = self.restock_authorization(
            1,
            expires_at=int(pi_unlock_service.time.time() * 1000) + 60_000,
            nonce="overlong-123456789",
        )
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            first = self.client.post(
                "/restock/unlock", json={"slotNumber": 1, "authorization": valid}
            )
            replay = self.client.post(
                "/restock/unlock", json={"slotNumber": 1, "authorization": valid}
            )
            expired_response = self.client.post(
                "/restock/unlock", json={"slotNumber": 1, "authorization": expired}
            )
            overlong_response = self.client.post(
                "/restock/unlock", json={"slotNumber": 1, "authorization": overlong}
            )
            tampered = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 1, "authorization": f"{valid}x"},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(replay.status_code, 409)
        self.assertEqual(expired_response.status_code, 403)
        self.assertEqual(overlong_response.status_code, 403)
        self.assertEqual(tampered.status_code, 403)

    def test_payment_unlock_idempotency_remains_separate_from_restock_unlock(self) -> None:
        authorization = self.restock_authorization(3)
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            restock = self.client.post(
                "/restock/unlock",
                json={"slotNumber": 3, "authorization": authorization},
            )
            payment = self.client.post(
                "/unlock", json={"slotNumber": 3, "transactionId": 91}
            )

        self.assertEqual(restock.status_code, 200)
        self.assertEqual(payment.status_code, 200)
        self.assertFalse(payment.get_json()["data"]["deduplicated"])


class AudioPlaybackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = pi_unlock_service.app.test_client()
        self.assets_directory = tempfile.TemporaryDirectory()
        self.asset_path = Path(self.assets_directory.name)
        self.asset_directory_patch = patch.object(
            pi_unlock_service, "AUDIO_ASSET_DIRECTORY", self.asset_path
        )
        self.mock_audio_patch = patch.object(pi_unlock_service, "MOCK_AUDIO", False)
        self.asset_directory_patch.start()
        self.mock_audio_patch.start()

    def tearDown(self) -> None:
        self.asset_directory_patch.stop()
        self.mock_audio_patch.stop()
        self.assets_directory.cleanup()
        if pi_unlock_service.audio_playback_lock.locked():
            pi_unlock_service.audio_playback_lock.release()

    def create_asset(self, event: str) -> Path:
        asset = self.asset_path / pi_unlock_service.AUDIO_EVENT_FILES[event]
        asset.touch()
        return asset

    def test_each_semantic_event_maps_to_its_fixed_asset(self) -> None:
        expected_files = {
            "PAYMENT_SUCCESS": "payment_success.wav",
            "UNLOCK_FAILED": "unlock_failed.wav",
            "EMPLOYEE_AUTH_SUCCESS": "employee_auth_success.wav",
            "RESTOCK_COMPLETE": "restock_complete.wav",
        }

        for event, filename in expected_files.items():
            with self.subTest(event=event):
                expected_path = self.create_asset(event)
                with patch.object(pi_unlock_service, "play_audio_asset") as player:
                    response = self.client.post("/audio/play", json={"event": event})

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.get_json(), {"status": "AUDIO_PLAYED", "event": event}
                )
                self.assertEqual(expected_path.name, filename)
                player.assert_called_once_with(expected_path)

    def test_invalid_event_and_client_controlled_paths_are_rejected(self) -> None:
        invalid_requests = (
            {"event": "../../etc/passwd"},
            {"event": "https://example.com/audio.wav"},
            {"event": "payment_success.wav"},
            {"event": "PAYMENT_SUCCESS", "filename": "../../tmp/attack.wav"},
            {"event": "PAYMENT_SUCCESS", "alsaDevice": "default"},
            {"event": "PAYMENT_SUCCESS", "arguments": ["-D", "default"]},
            {"event": "PAYMENT_SUCCESS", "executable": "/tmp/attack"},
        )

        with patch.object(pi_unlock_service, "play_audio_asset") as player:
            for body in invalid_requests:
                with self.subTest(body=body):
                    response = self.client.post("/audio/play", json=body)
                    self.assertEqual(response.status_code, 400)

        player.assert_not_called()

    def test_missing_asset_returns_safe_unavailable_response(self) -> None:
        response = self.client.post(
            "/audio/play", json={"event": "PAYMENT_SUCCESS"}
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.get_json(),
            {
                "status": "UNAVAILABLE",
                "event": "PAYMENT_SUCCESS",
                "error": "Audio playback is unavailable.",
            },
        )
        self.assertNotIn(str(self.asset_path), response.get_data(as_text=True))

    def test_unavailable_or_failing_player_returns_safe_failure(self) -> None:
        self.create_asset("PAYMENT_SUCCESS")
        failures = (
            FileNotFoundError("sensitive executable path"),
            subprocess.CalledProcessError(1, ["aplay"], stderr="sensitive output"),
        )

        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with patch.object(
                    pi_unlock_service, "play_audio_asset", side_effect=failure
                ):
                    response = self.client.post(
                        "/audio/play", json={"event": "PAYMENT_SUCCESS"}
                    )

                self.assertEqual(response.status_code, 503)
                self.assertNotIn("sensitive", response.get_data(as_text=True))

    def test_playback_timeout_returns_safe_failure(self) -> None:
        self.create_asset("RESTOCK_COMPLETE")
        timeout = subprocess.TimeoutExpired(["aplay"], 10, stderr="sensitive output")

        with patch.object(pi_unlock_service, "play_audio_asset", side_effect=timeout):
            response = self.client.post(
                "/audio/play", json={"event": "RESTOCK_COMPLETE"}
            )

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("sensitive", response.get_data(as_text=True))

    def test_concurrent_playback_is_rejected_as_busy(self) -> None:
        self.create_asset("UNLOCK_FAILED")
        self.assertTrue(pi_unlock_service.audio_playback_lock.acquire(blocking=False))

        response = self.client.post(
            "/audio/play", json={"event": "UNLOCK_FAILED"}
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["status"], "BUSY")

    def test_audio_failure_does_not_crash_service(self) -> None:
        self.create_asset("EMPLOYEE_AUTH_SUCCESS")
        with patch.object(
            pi_unlock_service,
            "play_audio_asset",
            side_effect=OSError("sensitive device failure"),
        ):
            audio_response = self.client.post(
                "/audio/play", json={"event": "EMPLOYEE_AUTH_SUCCESS"}
            )

        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            health_response = self.client.get("/health")

        self.assertEqual(audio_response.status_code, 503)
        self.assertEqual(health_response.status_code, 200)

    def test_player_uses_default_alsa_device_when_configuration_is_absent(self) -> None:
        asset = self.create_asset("PAYMENT_SUCCESS")

        with patch.dict("os.environ", {"AUDIO_ALSA_DEVICE": ""}):
            with patch.object(pi_unlock_service.subprocess, "run") as run:
                pi_unlock_service.play_audio_asset(asset)

        run.assert_called_once_with(
            ["aplay", "--quiet", str(asset)],
            check=True,
            timeout=pi_unlock_service.AUDIO_PLAYBACK_TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def test_configured_alsa_device_is_passed_with_fixed_device_argument(self) -> None:
        asset = self.create_asset("PAYMENT_SUCCESS")
        configured_device = "plughw:CARD=UACDemoV10,DEV=0"

        with patch.dict("os.environ", {"AUDIO_ALSA_DEVICE": configured_device}):
            with patch.object(pi_unlock_service.subprocess, "run") as run:
                pi_unlock_service.play_audio_asset(asset)

        run.assert_called_once_with(
            ["aplay", "--quiet", "-D", configured_device, str(asset)],
            check=True,
            timeout=pi_unlock_service.AUDIO_PLAYBACK_TIMEOUT_SECONDS,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def test_explicit_mock_audio_mode_is_disclosed(self) -> None:
        with patch.object(pi_unlock_service, "MOCK_AUDIO", True):
            response = self.client.post(
                "/audio/play", json={"event": "PAYMENT_SUCCESS"}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "status": "AUDIO_PLAYED",
                "event": "PAYMENT_SUCCESS",
                "mockAudio": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
