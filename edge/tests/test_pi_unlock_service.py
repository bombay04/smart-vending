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
        self.client = pi_unlock_service.app.test_client()
        pi_unlock_service.face_engine = None
        self.clock = FakeClock()
        self.original_lockout = pi_unlock_service.face_authentication_lockout
        pi_unlock_service.face_authentication_lockout = (
            pi_unlock_service.FaceAuthenticationLockout(clock=self.clock)
        )

    def tearDown(self) -> None:
        pi_unlock_service.face_engine = None
        pi_unlock_service.face_authentication_lockout = self.original_lockout
        if pi_unlock_service.face_authentication_lock.locked():
            pi_unlock_service.face_authentication_lock.release()

    def post_face_authentication(self):
        return self.client.post("/face/authenticate")

    def post_face_registration(self, employee_code: object = "EMP001"):
        return self.client.post("/face/register", json={"employeeCode": employee_code})

    def post_face_registration_status(self, employee_codes: object):
        return self.client.post(
            "/face/registration/status", json={"employeeCodes": employee_codes}
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
        self.assertEqual(
            response.get_json(),
            {
                "status": "MATCH",
                "employeeCode": "EMP001",
                "distance": 0.437637,
                "threshold": 1.128,
            },
        )
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
                response = thread_client.post("/face/authenticate")
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
        factory.assert_called_once_with()

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

    def test_mock_unlock_and_status_endpoints_still_work(self) -> None:
        with patch.object(pi_unlock_service, "MOCK_HARDWARE", True):
            status_response = self.client.get("/hardware/status")
            unlock_response = self.client.post("/unlock", json={"slotNumber": 1})

        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(len(status_response.get_json()["slots"]), 3)
        self.assertEqual(unlock_response.status_code, 200)
        self.assertEqual(
            unlock_response.get_json()["data"]["status"], "UNLOCK_COMMAND_SENT"
        )


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

    def test_player_uses_fixed_command_without_a_shell(self) -> None:
        asset = self.create_asset("PAYMENT_SUCCESS")

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
