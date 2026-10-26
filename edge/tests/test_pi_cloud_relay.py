from __future__ import annotations

import io
import json
import logging
import unittest

from edge.pi_cloud_relay import (
    HardwareHeartbeatWorker,
    MAX_REQUEST_BYTES,
    RelayConfig,
    RelayTimeoutError,
    RelayTransportError,
    UpstreamResponse,
    create_app,
)


class FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str], bytes | None]] = []
        self.response = UpstreamResponse(
            status=200,
            headers={"content-type": "application/json; charset=utf-8"},
            body=b'{"status":"ok"}',
        )
        self.error: Exception | None = None

    def request(
        self,
        method: str,
        path: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> UpstreamResponse:
        self.calls.append((method, path, dict(headers), body))
        if self.error is not None:
            raise self.error
        return self.response


class PiCloudRelayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.transport = FakeTransport()
        self.config = RelayConfig(
            upstream_origin="https://pi-api.smartvendingpt.com",
            client_id="test-client-id.access",
            client_secret="test-client-secret",
        )
        self.app = create_app(self.config, self.transport)
        self.app.testing = True
        self.client = self.app.test_client()

    def assert_forwarded(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, object] | None = None,
        expected_body: bytes | None = None,
    ) -> None:
        response = self.client.open(path, method=method, json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.transport.calls), 1)
        forwarded_method, forwarded_path, headers, forwarded_body = (
            self.transport.calls[0]
        )
        self.assertEqual(forwarded_method, method)
        self.assertEqual(forwarded_path, path)
        self.assertEqual(headers["CF-Access-Client-Id"], "test-client-id.access")
        self.assertEqual(headers["CF-Access-Client-Secret"], "test-client-secret")
        if expected_body is not None:
            self.assertEqual(forwarded_body, expected_body)

    def test_every_allowlisted_method_and_path_is_forwarded(self) -> None:
        cases = [
            ("GET", "/api/v1/slots", None),
            ("POST", "/api/v1/transactions/payments", {"slotNumber": 1}),
            ("GET", "/api/v1/transactions/7/payment-status", None),
            ("POST", "/api/v1/transactions/7/cancel", None),
            ("GET", "/api/v1/kiosk-sessions/current", None),
            ("POST", "/api/v1/kiosk-sessions/8/cancel", {}),
            (
                "POST",
                "/api/v1/employees/auth/face",
                {"employeeCode": "EMP001", "sessionId": 8},
            ),
            ("POST", "/api/v1/restocks/mock", {"sessionId": 8, "employeeId": 1}),
            (
                "POST",
                "/api/v1/restocks/unlock-grant",
                {
                    "sessionId": 8,
                    "slotNumber": 2,
                    "faceAuthorization": "signed-face-proof",
                },
            ),
            (
                "POST",
                "/api/v1/employees/face-registration/complete",
                {"sessionId": 8},
            ),
            (
                "POST",
                "/api/v1/kiosk-sessions/8/draft-delete-result",
                {"templateExists": True},
            ),
            (
                "POST",
                "/api/v1/kiosk-sessions/8/offboarding-complete",
                {},
            ),
        ]

        for method, path, body in cases:
            with self.subTest(method=method, path=path):
                self.transport.calls.clear()
                response = self.client.open(path, method=method, json=body)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    [(call[0], call[1]) for call in self.transport.calls],
                    [(method, path)],
                )

    def test_restock_unlock_grant_uses_exact_path_and_service_token_forwarding(self) -> None:
        body = (
            b'{"sessionId":17,"slotNumber":2,'
            b'"faceAuthorization":"signed-face-proof"}'
        )
        response = self.client.post(
            "/api/v1/restocks/unlock-grant",
            data=body,
            content_type="application/json",
            headers={
                "Authorization": "Bearer attacker",
                "CF-Access-Client-Id": "attacker-id",
                "CF-Access-Client-Secret": "attacker-secret",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.transport.calls), 1)
        method, path, headers, forwarded_body = self.transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/api/v1/restocks/unlock-grant")
        self.assertEqual(forwarded_body, body)
        self.assertEqual(headers["CF-Access-Client-Id"], "test-client-id.access")
        self.assertEqual(headers["CF-Access-Client-Secret"], "test-client-secret")
        self.assertNotIn("Authorization", headers)

    def test_denies_backend_and_local_hardware_routes(self) -> None:
        cases = [
            ("GET", "/api/v1/admin/slots"),
            ("POST", "/api/v1/employees"),
            ("PATCH", "/api/v1/employees/1"),
            ("DELETE", "/api/v1/employees/1"),
            ("POST", "/api/v1/transactions/omise/webhook"),
            ("GET", "/api/v1/products"),
            ("POST", "/unlock"),
            ("GET", "/https://attacker.example/api/v1/slots"),
        ]
        for method, path in cases:
            with self.subTest(method=method, path=path):
                response = self.client.open(path, method=method)
                self.assertIn(response.status_code, (404, 405))
        self.assertEqual(self.transport.calls, [])

    def test_denies_wrong_methods_without_forwarding(self) -> None:
        for method, path in [
            ("POST", "/api/v1/slots"),
            ("GET", "/api/v1/transactions/payments"),
            ("DELETE", "/api/v1/kiosk-sessions/8/cancel"),
            ("GET", "/api/v1/restocks/unlock-grant"),
            ("PUT", "/api/v1/restocks/unlock-grant"),
        ]:
            with self.subTest(method=method, path=path):
                response = self.client.open(path, method=method)
                self.assertEqual(response.status_code, 405)
        self.assertEqual(self.transport.calls, [])

    def test_restock_unlock_grant_does_not_widen_the_relay_path(self) -> None:
        for path in [
            "/api/v1/restocks/unlock-grant/1",
            "/api/v1/restocks/unlock-grant/extra",
            "/api/v1/restocks/unlock",
        ]:
            with self.subTest(path=path):
                response = self.client.post(path, json={})
                self.assertEqual(response.status_code, 404)
        self.assertEqual(self.transport.calls, [])

    def test_dynamic_identifiers_must_be_positive_decimal_integers(self) -> None:
        cases = [
            ("GET", "/api/v1/transactions/0/payment-status", 400),
            ("GET", "/api/v1/transactions/-1/payment-status", 404),
            ("GET", "/api/v1/transactions/not-a-number/payment-status", 404),
            ("GET", "/api/v1/transactions/2147483648/payment-status", 400),
            ("GET", "/api/v1/transactions/1%2Fcancel/payment-status", 404),
            ("POST", "/api/v1/kiosk-sessions/0/cancel", 400),
            ("POST", "/api/v1/kiosk-sessions/1.5/cancel", 404),
        ]
        for method, path, expected_status in cases:
            with self.subTest(path=path):
                response = self.client.open(path, method=method, json={})
                self.assertEqual(response.status_code, expected_status)
        self.assertEqual(self.transport.calls, [])

    def test_query_strings_are_rejected(self) -> None:
        response = self.client.get("/api/v1/slots?target=https://attacker.example")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.transport.calls, [])

    def test_client_headers_are_stripped_and_credentials_are_injected(self) -> None:
        response = self.client.get(
            "/api/v1/slots",
            headers={
                "Authorization": "Bearer attacker",
                "Cookie": "session=attacker",
                "CF-Access-Client-Id": "attacker-id",
                "CF-Access-Client-Secret": "attacker-secret",
                "X-Forwarded-Host": "attacker.example",
            },
        )
        self.assertEqual(response.status_code, 200)
        headers = self.transport.calls[0][2]
        self.assertEqual(headers["CF-Access-Client-Id"], "test-client-id.access")
        self.assertEqual(headers["CF-Access-Client-Secret"], "test-client-secret")
        self.assertNotIn("Authorization", headers)
        self.assertNotIn("Cookie", headers)
        self.assertNotIn("X-Forwarded-Host", headers)

    def test_json_rules_are_strict(self) -> None:
        missing = self.client.post("/api/v1/transactions/payments")
        self.assertEqual(missing.status_code, 400)

        wrong_type = self.client.post(
            "/api/v1/transactions/payments",
            data='{"slotNumber":1}',
            content_type="text/plain",
        )
        self.assertEqual(wrong_type.status_code, 415)

        malformed = self.client.post(
            "/api/v1/transactions/payments",
            data="{",
            content_type="application/json",
        )
        self.assertEqual(malformed.status_code, 400)

        array_body = self.client.post(
            "/api/v1/transactions/payments",
            data="[]",
            content_type="application/json",
        )
        self.assertEqual(array_body.status_code, 400)
        self.assertEqual(self.transport.calls, [])

    def test_body_size_limit_is_enforced(self) -> None:
        response = self.client.post(
            "/api/v1/transactions/payments",
            data=b"x" * (MAX_REQUEST_BYTES + 1),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.transport.calls, [])

    def test_cors_allows_only_the_local_kiosk_origin(self) -> None:
        preflight = self.client.options(
            "/api/v1/transactions/payments",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        self.assertEqual(preflight.status_code, 204)
        self.assertEqual(
            preflight.headers["Access-Control-Allow-Origin"],
            "http://localhost:5173",
        )
        self.assertNotIn("Access-Control-Allow-Credentials", preflight.headers)

        denied = self.client.get(
            "/api/v1/slots", headers={"Origin": "https://attacker.example"}
        )
        self.assertEqual(denied.status_code, 403)
        self.assertNotIn("Access-Control-Allow-Origin", denied.headers)
        self.assertEqual(self.transport.calls, [])

    def test_upstream_status_and_json_content_type_are_propagated(self) -> None:
        self.transport.response = UpstreamResponse(
            status=409,
            headers={"content-type": "application/problem+json"},
            body=b'{"error":"conflict"}',
        )
        response = self.client.get("/api/v1/slots")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.content_type, "application/problem+json")
        self.assertEqual(response.get_json(), {"error": "conflict"})

    def test_redirect_and_non_json_responses_are_rejected(self) -> None:
        for response in [
            UpstreamResponse(
                status=302,
                headers={
                    "content-type": "text/html",
                    "location": "https://attacker.example",
                },
                body=b"redirect",
            ),
            UpstreamResponse(
                status=200,
                headers={"content-type": "text/html"},
                body=b"<html>login</html>",
            ),
            UpstreamResponse(
                status=200,
                headers={"content-type": "application/json"},
                body=b"not-json",
            ),
        ]:
            with self.subTest(status=response.status, body=response.body):
                self.transport.response = response
                result = self.client.get("/api/v1/slots")
                self.assertEqual(result.status_code, 502)

    def test_timeout_and_transport_failures_are_safe_and_not_retried(self) -> None:
        for error, expected_status in [
            (RelayTimeoutError("contains test-client-secret"), 504),
            (RelayTransportError("contains test-client-secret"), 502),
        ]:
            with self.subTest(expected_status=expected_status):
                self.transport.calls.clear()
                self.transport.error = error
                response = self.client.post(
                    "/api/v1/transactions/payments", json={"slotNumber": 1}
                )
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(len(self.transport.calls), 1)
                self.assertNotIn("test-client-secret", response.get_data(as_text=True))

    def test_credentials_are_not_rendered_or_logged_on_failure(self) -> None:
        self.assertNotIn("test-client-secret", repr(self.config))
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        self.app.logger.addHandler(handler)
        self.transport.error = RelayTransportError(
            "upstream echoed test-client-id.access and test-client-secret"
        )
        try:
            response = self.client.get("/api/v1/slots")
        finally:
            self.app.logger.removeHandler(handler)
        self.assertEqual(response.status_code, 502)
        log_output = stream.getvalue()
        self.assertNotIn("test-client-id.access", log_output)
        self.assertNotIn("test-client-secret", log_output)


class HardwareHeartbeatWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.transport = FakeTransport()
        self.transport.response = UpstreamResponse(
            status=202,
            headers={"content-type": "application/json"},
            body=b'{"status":"accepted"}',
        )
        self.config = RelayConfig(
            upstream_origin="https://pi-api.smartvendingpt.com",
            client_id="machine-specific-client.access",
            client_secret="machine-specific-secret",
        )

    def test_heartbeat_is_outbound_authenticated_and_works_without_browser(self) -> None:
        worker = HardwareHeartbeatWorker(
            self.config,
            "PILOT_KIOSK",
            transport=self.transport,
            clock=lambda: 1_798_000_000.0,
        )
        self.assertTrue(worker.step())
        method, path, headers, body = self.transport.calls[0]
        self.assertEqual((method, path), ("POST", "/api/v1/hardware/heartbeat"))
        self.assertEqual(headers["CF-Access-Client-Id"], "machine-specific-client.access")
        payload = json.loads(body or b"{}")
        self.assertEqual(
            set(payload), {"version", "machineId", "sequence", "observedAt"}
        )
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["machineId"], "PILOT_KIOSK")
        self.assertEqual(payload["observedAt"], "2026-12-23T04:26:40.000Z")
        self.assertGreater(payload["sequence"], 0)

    def test_transient_cloud_failure_is_not_retried_inside_one_step(self) -> None:
        worker = HardwareHeartbeatWorker(
            self.config, "PILOT_KIOSK", transport=self.transport
        )
        self.transport.error = RelayTransportError("offline")

        self.assertFalse(worker.step())
        self.assertEqual(len(self.transport.calls), 1)


if __name__ == "__main__":
    unittest.main()
