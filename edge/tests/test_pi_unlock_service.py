from __future__ import annotations

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

    def recognize(self) -> RecognitionResult:
        if self.error is not None:
            raise self.error
        if self.result is None:
            raise AssertionError("StubFaceEngine requires a result or error.")
        return self.result


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

    def tearDown(self) -> None:
        pi_unlock_service.face_engine = None
        if pi_unlock_service.face_authentication_lock.locked():
            pi_unlock_service.face_authentication_lock.release()

    def post_face_authentication(self):
        return self.client.post("/face/authenticate")

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
        self.assertEqual(response.get_json(), {"status": "NO_MATCH"})

    def test_no_face_remains_distinguishable(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(
            error=NoFaceError("No face detected.")
        )

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json(), {"status": "NO_FACE"})

    def test_multiple_faces_remains_distinguishable(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(
            error=MultipleFacesError("Multiple faces detected.")
        )

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json(), {"status": "MULTIPLE_FACES"})

    def test_concurrent_scan_returns_busy_without_running_engine(self) -> None:
        pi_unlock_service.face_engine = StubFaceEngine(recognition_result(matched=True))
        self.assertTrue(pi_unlock_service.face_authentication_lock.acquire(blocking=False))

        response = self.post_face_authentication()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json(), {"status": "BUSY"})

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
