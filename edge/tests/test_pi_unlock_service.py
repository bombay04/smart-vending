from __future__ import annotations

import threading
import unittest
from unittest.mock import patch

from edge.face.errors import CameraError, ModelError, MultipleFacesError, NoFaceError
from edge.face.models import RecognitionResult
from edge import pi_unlock_service


class StubFaceEngine:
    def __init__(
        self,
        result: RecognitionResult | None = None,
        error: Exception | None = None,
    ) -> None:
        self.result = result
        self.error = error
        self.recognize_calls = 0

    def recognize(self) -> RecognitionResult:
        self.recognize_calls += 1
        if self.error is not None:
            raise self.error
        if self.result is None:
            raise AssertionError("StubFaceEngine requires a result or error.")
        return self.result


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


if __name__ == "__main__":
    unittest.main()
