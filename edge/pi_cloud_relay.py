"""Loopback-only allowlisted relay from the Raspberry Pi kiosk to the cloud API."""

from __future__ import annotations

from dataclasses import dataclass, field
import http.client
import json
import logging
import os
import socket
from typing import Callable, Mapping, Protocol
from urllib.parse import urlsplit

from flask import Flask, Response, jsonify, request
from werkzeug.exceptions import MethodNotAllowed, NotFound


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 3000
DEFAULT_UPSTREAM_ORIGIN = "https://pi-api.smartvendingpt.com"
ALLOWED_BROWSER_ORIGIN = "http://localhost:5173"
MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 1024 * 1024
MAX_BACKEND_INTEGER = 2_147_483_647
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5.0
DEFAULT_READ_TIMEOUT_SECONDS = 30.0


class RelayTransportError(Exception):
    """Raised when the fixed upstream cannot be reached safely."""


class RelayTimeoutError(RelayTransportError):
    """Raised when the fixed upstream exceeds a configured timeout."""


@dataclass(frozen=True)
class UpstreamResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class RelayTransport(Protocol):
    def request(
        self,
        method: str,
        path: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> UpstreamResponse: ...


def _positive_float_from_environment(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        value = float(raw_value)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive number.") from error
    if value <= 0:
        raise ValueError(f"{name} must be a positive number.")
    return value


def _validated_upstream_origin(value: str) -> tuple[str, int]:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("PI_CLOUD_UPSTREAM_ORIGIN must be an HTTPS origin without a path.")
    try:
        port = parsed.port or 443
    except ValueError as error:
        raise ValueError("PI_CLOUD_UPSTREAM_ORIGIN contains an invalid port.") from error
    return parsed.hostname, port


@dataclass(frozen=True)
class RelayConfig:
    upstream_origin: str
    client_id: str = field(repr=False)
    client_secret: str = field(repr=False)
    connect_timeout_seconds: float = DEFAULT_CONNECT_TIMEOUT_SECONDS
    read_timeout_seconds: float = DEFAULT_READ_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        _validated_upstream_origin(self.upstream_origin)
        if not self.client_id or not self.client_secret:
            raise ValueError("Cloudflare Access service credentials are required.")

    @classmethod
    def from_environment(cls) -> "RelayConfig":
        return cls(
            upstream_origin=os.getenv(
                "PI_CLOUD_UPSTREAM_ORIGIN", DEFAULT_UPSTREAM_ORIGIN
            ).rstrip("/"),
            client_id=os.getenv("CF_ACCESS_CLIENT_ID", ""),
            client_secret=os.getenv("CF_ACCESS_CLIENT_SECRET", ""),
            connect_timeout_seconds=_positive_float_from_environment(
                "PI_CLOUD_CONNECT_TIMEOUT_SECONDS",
                DEFAULT_CONNECT_TIMEOUT_SECONDS,
            ),
            read_timeout_seconds=_positive_float_from_environment(
                "PI_CLOUD_READ_TIMEOUT_SECONDS",
                DEFAULT_READ_TIMEOUT_SECONDS,
            ),
        )


class HttpsRelayTransport:
    """Small HTTPS client with a fixed origin and no redirect behavior."""

    def __init__(self, config: RelayConfig) -> None:
        self._hostname, self._port = _validated_upstream_origin(
            config.upstream_origin
        )
        self._connect_timeout = config.connect_timeout_seconds
        self._read_timeout = config.read_timeout_seconds

    def request(
        self,
        method: str,
        path: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> UpstreamResponse:
        connection = http.client.HTTPSConnection(
            self._hostname,
            self._port,
            timeout=self._connect_timeout,
        )
        try:
            connection.connect()
            if connection.sock is None:
                raise RelayTransportError("The upstream TLS socket was not created.")
            connection.sock.settimeout(self._read_timeout)
            connection.request(method, path, body=body, headers=dict(headers))
            response = connection.getresponse()
            content_length = response.getheader("Content-Length")
            if content_length is not None:
                try:
                    if int(content_length) > MAX_RESPONSE_BYTES:
                        raise RelayTransportError("The upstream response was too large.")
                except ValueError as error:
                    raise RelayTransportError(
                        "The upstream Content-Length was invalid."
                    ) from error
            response_body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(response_body) > MAX_RESPONSE_BYTES:
                raise RelayTransportError("The upstream response was too large.")
            return UpstreamResponse(
                status=response.status,
                headers={name.lower(): value for name, value in response.getheaders()},
                body=response_body,
            )
        except (TimeoutError, socket.timeout) as error:
            raise RelayTimeoutError("The upstream request timed out.") from error
        except RelayTransportError:
            raise
        except (OSError, http.client.HTTPException) as error:
            raise RelayTransportError("The upstream request failed.") from error
        finally:
            connection.close()


def _is_json_content_type(value: str) -> bool:
    media_type = value.split(";", 1)[0].strip().lower()
    return media_type == "application/json" or media_type.endswith("+json")


def _json_error(message: str, status: int, code: str) -> tuple[Response, int]:
    return jsonify({"error": message, "code": code}), status


def create_app(
    config: RelayConfig,
    transport: RelayTransport | None = None,
    logger: logging.Logger | None = None,
) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
    upstream_transport = transport or HttpsRelayTransport(config)
    if logger is not None:
        app.logger.handlers = logger.handlers
        app.logger.setLevel(logger.level)

    allowed_routes: set[tuple[str, str]] = set()

    @app.before_request
    def enforce_local_browser_origin() -> tuple[Response, int] | None:
        if request.path == "/health":
            return None
        origin = request.headers.get("Origin")
        if origin is not None and origin != ALLOWED_BROWSER_ORIGIN:
            return _json_error("Origin is not allowed.", 403, "ORIGIN_DENIED")
        if request.query_string:
            return _json_error(
                "Query parameters are not supported.", 400, "QUERY_NOT_SUPPORTED"
            )
        if request.method == "OPTIONS":
            requested_method = request.headers.get("Access-Control-Request-Method", "")
            if requested_method not in {"GET", "POST"}:
                return _json_error(
                    "Method is not allowed.", 405, "METHOD_NOT_ALLOWED"
                )
            try:
                app.url_map.bind("localhost").match(
                    request.path, method=requested_method
                )
            except (NotFound, MethodNotAllowed):
                return _json_error(
                    "Route is not allowed.", 404, "ROUTE_NOT_ALLOWED"
                )
            return Response(status=204)
        return None

    @app.after_request
    def add_cors_headers(response: Response) -> Response:
        if request.headers.get("Origin") == ALLOWED_BROWSER_ORIGIN:
            response.headers["Access-Control-Allow-Origin"] = ALLOWED_BROWSER_ORIGIN
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
            response.headers["Vary"] = "Origin"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(413)
    def request_too_large(_error: object) -> tuple[Response, int]:
        return _json_error("Request body is too large.", 413, "REQUEST_TOO_LARGE")

    @app.errorhandler(404)
    def route_not_allowed(_error: object) -> tuple[Response, int]:
        return _json_error("Route is not allowed.", 404, "ROUTE_NOT_ALLOWED")

    @app.errorhandler(405)
    def method_not_allowed(_error: object) -> tuple[Response, int]:
        return _json_error("Method is not allowed.", 405, "METHOD_NOT_ALLOWED")

    @app.get("/health")
    def health() -> Response:
        return jsonify({"status": "ok", "upstreamConfigured": True})

    def forward(
        method: str,
        upstream_path: str,
        *,
        json_body: str,
    ) -> tuple[Response, int] | Response:
        body: bytes | None = None
        if json_body not in {"none", "required", "optional"}:
            raise AssertionError("Invalid relay body policy.")

        if json_body != "none":
            raw_body = request.get_data(cache=True)
            if not raw_body and json_body == "required":
                return _json_error("A JSON body is required.", 400, "JSON_REQUIRED")
            if raw_body:
                if request.mimetype != "application/json":
                    return _json_error(
                        "Content-Type must be application/json.",
                        415,
                        "JSON_CONTENT_TYPE_REQUIRED",
                    )
                try:
                    decoded = json.loads(raw_body)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    return _json_error("JSON body is invalid.", 400, "INVALID_JSON")
                if not isinstance(decoded, dict):
                    return _json_error(
                        "JSON body must be an object.", 400, "INVALID_JSON_SHAPE"
                    )
                body = raw_body
        elif request.get_data(cache=False):
            return _json_error(
                "This route does not accept a request body.",
                400,
                "BODY_NOT_SUPPORTED",
            )

        headers = {
            "Accept": "application/json",
            "CF-Access-Client-Id": config.client_id,
            "CF-Access-Client-Secret": config.client_secret,
            "User-Agent": "smart-vending-pi-cloud-relay/1",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"

        try:
            upstream_response = upstream_transport.request(
                method, upstream_path, headers, body
            )
        except RelayTimeoutError:
            app.logger.warning(
                "Pi cloud relay upstream timeout: method=%s route=%s",
                method,
                request.url_rule.rule if request.url_rule else "unknown",
            )
            return _json_error(
                "Cloud API request timed out.", 504, "UPSTREAM_TIMEOUT"
            )
        except RelayTransportError:
            app.logger.warning(
                "Pi cloud relay upstream failure: method=%s route=%s",
                method,
                request.url_rule.rule if request.url_rule else "unknown",
            )
            return _json_error(
                "Cloud API is unavailable.", 502, "UPSTREAM_UNAVAILABLE"
            )

        if 300 <= upstream_response.status < 400:
            return _json_error(
                "Cloud API returned an unsupported redirect.",
                502,
                "UPSTREAM_REDIRECT_REJECTED",
            )

        content_type = upstream_response.headers.get("content-type", "")
        if not _is_json_content_type(content_type):
            return _json_error(
                "Cloud API returned an invalid response.",
                502,
                "UPSTREAM_RESPONSE_INVALID",
            )
        try:
            json.loads(upstream_response.body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _json_error(
                "Cloud API returned an invalid response.",
                502,
                "UPSTREAM_RESPONSE_INVALID",
            )

        response = Response(
            upstream_response.body,
            status=upstream_response.status,
            content_type=content_type,
        )
        return response

    def register(
        rule: str,
        method: str,
        path_builder: Callable[..., str],
        *,
        json_body: str = "none",
    ) -> None:
        endpoint = f"relay_{method.lower()}_{len(allowed_routes)}"
        allowed_routes.add((method, rule))

        def handler(**values: int) -> tuple[Response, int] | Response:
            if any(
                value <= 0 or value > MAX_BACKEND_INTEGER
                for value in values.values()
            ):
                return _json_error(
                    "Route identifier must be a positive integer.",
                    400,
                    "INVALID_ROUTE_IDENTIFIER",
                )
            return forward(method, path_builder(**values), json_body=json_body)

        app.add_url_rule(
            rule,
            endpoint,
            handler,
            methods=[method],
            provide_automatic_options=True,
        )

    register("/api/v1/slots", "GET", lambda: "/api/v1/slots")
    register(
        "/api/v1/transactions/payments",
        "POST",
        lambda: "/api/v1/transactions/payments",
        json_body="required",
    )
    register(
        "/api/v1/transactions/<int:transaction_id>/payment-status",
        "GET",
        lambda transaction_id: f"/api/v1/transactions/{transaction_id}/payment-status",
    )
    register(
        "/api/v1/transactions/<int:transaction_id>/cancel",
        "POST",
        lambda transaction_id: f"/api/v1/transactions/{transaction_id}/cancel",
        json_body="optional",
    )
    register(
        "/api/v1/kiosk-sessions/current",
        "GET",
        lambda: "/api/v1/kiosk-sessions/current",
    )
    register(
        "/api/v1/kiosk-sessions/<int:session_id>/cancel",
        "POST",
        lambda session_id: f"/api/v1/kiosk-sessions/{session_id}/cancel",
        json_body="required",
    )
    register(
        "/api/v1/employees/auth/face",
        "POST",
        lambda: "/api/v1/employees/auth/face",
        json_body="required",
    )
    register(
        "/api/v1/restocks/mock",
        "POST",
        lambda: "/api/v1/restocks/mock",
        json_body="required",
    )
    register(
        "/api/v1/employees/face-registration/complete",
        "POST",
        lambda: "/api/v1/employees/face-registration/complete",
        json_body="required",
    )
    register(
        "/api/v1/kiosk-sessions/<int:session_id>/draft-delete-result",
        "POST",
        lambda session_id: f"/api/v1/kiosk-sessions/{session_id}/draft-delete-result",
        json_body="required",
    )
    register(
        "/api/v1/kiosk-sessions/<int:session_id>/offboarding-complete",
        "POST",
        lambda session_id: f"/api/v1/kiosk-sessions/{session_id}/offboarding-complete",
        json_body="required",
    )

    return app


def main() -> None:
    config = RelayConfig.from_environment()
    host = os.getenv("PI_CLOUD_RELAY_HOST", DEFAULT_HOST)
    if host != DEFAULT_HOST:
        raise ValueError("PI_CLOUD_RELAY_HOST must remain 127.0.0.1.")
    raw_port = os.getenv("PI_CLOUD_RELAY_PORT", str(DEFAULT_PORT))
    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError("PI_CLOUD_RELAY_PORT must be an integer.") from error
    if not 1 <= port <= 65535:
        raise ValueError("PI_CLOUD_RELAY_PORT must be between 1 and 65535.")
    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    create_app(config).run(
        host=host,
        port=port,
        threaded=True,
        use_reloader=False,
    )


if __name__ == "__main__":
    main()
