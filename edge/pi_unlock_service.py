"""Local HTTP service that sends unlock commands to the vending ESP32."""

from __future__ import annotations

import atexit
import logging
import math
import os
from pathlib import Path
import subprocess
import threading
import time
from typing import Any, Callable, Protocol

from flask import Flask, Response, jsonify, request

if __package__:
    from .face.camera import capture_frame
    from .face.config import DEFAULT_CAMERA_INDEX
    from .face.engine import FaceEngine
    from .face.errors import (
        AlreadyRegisteredError,
        CameraError,
        FaceEngineError,
        MultipleFacesError,
        NoFaceError,
    )
    from .face.models import RecognitionResult
    from .face.storage import EMPLOYEE_CODE_PATTERN
    from .serial_client import Esp32SerialClient, SerialClientError
else:
    # Keep direct `python edge/pi_unlock_service.py` execution working on the Pi.
    from face.camera import capture_frame
    from face.config import DEFAULT_CAMERA_INDEX
    from face.engine import FaceEngine
    from face.errors import (
        AlreadyRegisteredError,
        CameraError,
        FaceEngineError,
        MultipleFacesError,
        NoFaceError,
    )
    from face.models import RecognitionResult
    from face.storage import EMPLOYEE_CODE_PATTERN
    from serial_client import Esp32SerialClient, SerialClientError


DEFAULT_BAUD_RATE = 115200
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000
ALLOWED_ORIGIN = "http://localhost:5173"
HARDWARE_STATUS_TIMEOUT_SECONDS = 3.0
MAX_FAILED_ATTEMPTS = 3
LOCKOUT_DURATION_SECONDS = 180
MAX_REGISTRATION_STATUS_CODES = 100
AUDIO_PLAYBACK_TIMEOUT_SECONDS = 10
AUDIO_PLAYER_COMMAND = ("aplay", "--quiet")
AUDIO_ASSET_DIRECTORY = Path(__file__).resolve().parent / "audio" / "assets"
AUDIO_EVENT_FILES = {
    "PAYMENT_SUCCESS": "payment_success.wav",
    "UNLOCK_FAILED": "unlock_failed.wav",
    "EMPLOYEE_AUTH_SUCCESS": "employee_auth_success.wav",
    "RESTOCK_COMPLETE": "restock_complete.wav",
}
CAMERA_STATUS_REASONS = {
    "OPEN_FAILURE",
    "READ_FAILURE",
    "INVALID_FRAME",
    "BLACK_FRAME",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("pi-unlock-service")

app = Flask(__name__)
serial_client: Esp32SerialClient | None = None
serial_operation_lock = threading.Lock()
face_authentication_lock = threading.Lock()
audio_playback_lock = threading.Lock()


class FaceRecognizer(Protocol):
    def recognize(self) -> RecognitionResult: ...

    def register(self, employee_code: str) -> object: ...

    def is_registered(self, employee_code: str) -> bool: ...


face_engine: FaceRecognizer | None = None


class FaceAuthenticationLockout:
    """Concurrency-safe, process-local face-authentication failure state."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._state_lock = threading.Lock()
        self._failed_attempts = 0
        self._locked_until: float | None = None

    def status(self) -> dict[str, int | str]:
        with self._state_lock:
            now = self._clock()
            self._expire_if_needed(now)

            if self._locked_until is not None:
                return {
                    "status": "LOCKED",
                    "retryAfterSeconds": self._retry_after_seconds(now),
                }

            return {
                "status": "READY",
                "failedAttempts": self._failed_attempts,
                "remainingAttempts": MAX_FAILED_ATTEMPTS - self._failed_attempts,
            }

    def record_failure(self) -> dict[str, int | str]:
        with self._state_lock:
            now = self._clock()
            self._expire_if_needed(now)

            if self._locked_until is not None:
                return {
                    "status": "LOCKED",
                    "retryAfterSeconds": self._retry_after_seconds(now),
                }

            self._failed_attempts += 1
            if self._failed_attempts >= MAX_FAILED_ATTEMPTS:
                self._failed_attempts = MAX_FAILED_ATTEMPTS
                self._locked_until = now + LOCKOUT_DURATION_SECONDS
                return {
                    "status": "LOCKED",
                    "retryAfterSeconds": LOCKOUT_DURATION_SECONDS,
                }

            return {
                "status": "READY",
                "failedAttempts": self._failed_attempts,
                "remainingAttempts": MAX_FAILED_ATTEMPTS - self._failed_attempts,
            }

    def reset_failures(self) -> None:
        with self._state_lock:
            self._failed_attempts = 0
            self._locked_until = None

    def _expire_if_needed(self, now: float) -> None:
        if self._locked_until is not None and now >= self._locked_until:
            self._failed_attempts = 0
            self._locked_until = None

    def _retry_after_seconds(self, now: float) -> int:
        if self._locked_until is None:
            raise RuntimeError("Lockout expiry requested while authentication is ready.")
        return max(1, min(LOCKOUT_DURATION_SECONDS, math.ceil(self._locked_until - now)))


face_authentication_lockout = FaceAuthenticationLockout()


def environment_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def environment_integer(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default

    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error


def configured_camera_index() -> int:
    camera_index = environment_integer("FACE_CAMERA_INDEX", DEFAULT_CAMERA_INDEX)
    if camera_index < 0:
        raise ValueError("FACE_CAMERA_INDEX must be non-negative.")
    return camera_index


MOCK_HARDWARE = environment_flag("MOCK_HARDWARE")
MOCK_AUDIO = environment_flag("MOCK_AUDIO")


@app.before_request
def handle_preflight() -> Response | None:
    if request.method == "OPTIONS":
        return Response(status=204)
    return None


@app.after_request
def add_cors_headers(response: Response) -> Response:
    response.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.get("/health")
def health() -> tuple[Response, int] | Response:
    if MOCK_HARDWARE:
        return jsonify(status="ok", hardware="mock", mockHardware=True)

    if serial_client is None or not serial_client.is_connected:
        return jsonify(status="error", hardware="disconnected", mockHardware=False), 503

    return jsonify(status="ok", hardware="connected", mockHardware=False)


def collect_hardware_status() -> list[dict[str, int | bool]]:
    if serial_client is None or not serial_client.is_connected:
        raise SerialClientError("Serial connection unavailable.")

    status_by_slot: dict[int, dict[str, bool]] = {1: {}, 2: {}, 3: {}}
    deadline = time.monotonic() + HARDWARE_STATUS_TIMEOUT_SECONDS

    serial_client.clear_input_buffer()
    serial_client.get_status()

    while time.monotonic() < deadline:
        line = serial_client.read_line()
        if line is None:
            continue

        parsed = serial_client.parse_status_line(line)
        if parsed is None:
            logger.debug("Ignoring unrelated ESP32 line: %s", line)
            continue

        message_type = parsed.get("type")
        slot_number = parsed.get("slot")
        sensor_status = parsed.get("status")

        if not isinstance(slot_number, int) or slot_number not in status_by_slot:
            continue

        if message_type == "IR" and sensor_status in ("PRESENT", "EMPTY"):
            status_by_slot[slot_number]["productPresent"] = sensor_status == "PRESENT"
        elif message_type == "DOOR" and sensor_status in ("OPEN", "CLOSED"):
            status_by_slot[slot_number]["doorClosed"] = sensor_status == "CLOSED"
        else:
            continue

        if all(
            "productPresent" in slot_status and "doorClosed" in slot_status
            for slot_status in status_by_slot.values()
        ):
            return [
                {
                    "slotNumber": slot_number,
                    "productPresent": status_by_slot[slot_number]["productPresent"],
                    "doorClosed": status_by_slot[slot_number]["doorClosed"],
                }
                for slot_number in (1, 2, 3)
            ]

    raise SerialClientError("Timed out waiting for complete ESP32 hardware status.")


@app.get("/hardware/status")
def hardware_status() -> tuple[Response, int] | Response:
    if MOCK_HARDWARE:
        return jsonify(
            status="ok",
            slots=[
                {"slotNumber": slot_number, "productPresent": True, "doorClosed": True}
                for slot_number in (1, 2, 3)
            ],
        )

    if serial_client is None or not serial_client.is_connected:
        return jsonify(error="Hardware status unavailable."), 503

    try:
        with serial_operation_lock:
            slots = collect_hardware_status()
        logger.info("Complete ESP32 hardware status collected")
        return jsonify(status="ok", slots=slots)
    except SerialClientError as error:
        logger.error("Hardware status collection failed: %s", error)
        return jsonify(error="Unable to collect complete hardware status."), 503
    except Exception:
        logger.exception("Unexpected hardware status error")
        return jsonify(error="Internal server error."), 500


def get_face_engine() -> FaceRecognizer:
    """Lazily initialize one YuNet/SFace runtime for the service lifecycle."""

    global face_engine

    if face_engine is None:
        face_engine = FaceEngine(camera_index=configured_camera_index())
        logger.info("Face authentication runtime initialized")
    return face_engine


def locked_response(lockout_status: dict[str, int | str]) -> tuple[Response, int]:
    return (
        jsonify(
            status="LOCKED",
            retryAfterSeconds=lockout_status["retryAfterSeconds"],
        ),
        423,
    )


def normalize_employee_code(employee_code: object) -> str | None:
    if not isinstance(employee_code, str):
        return None
    normalized = employee_code.strip().upper()
    if not EMPLOYEE_CODE_PATTERN.fullmatch(normalized):
        return None
    return normalized


def normalized_employee_code_from_request() -> str | None:
    if not request.is_json:
        return None
    body: Any = request.get_json(silent=True)
    if not isinstance(body, dict):
        return None
    return normalize_employee_code(body.get("employeeCode"))


def normalized_employee_codes_from_request() -> list[str] | None:
    if not request.is_json:
        return None
    body: Any = request.get_json(silent=True)
    if not isinstance(body, dict):
        return None
    employee_codes = body.get("employeeCodes")
    if not isinstance(employee_codes, list) or not (
        1 <= len(employee_codes) <= MAX_REGISTRATION_STATUS_CODES
    ):
        return None

    normalized_codes: list[str] = []
    seen: set[str] = set()
    for employee_code in employee_codes:
        normalized = normalize_employee_code(employee_code)
        if normalized is None:
            return None
        if normalized not in seen:
            normalized_codes.append(normalized)
            seen.add(normalized)
    return normalized_codes


@app.get("/face/auth/status")
def face_authentication_status() -> Response:
    response = jsonify(face_authentication_lockout.status())
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/camera/status")
def camera_status() -> tuple[Response, int] | Response:
    """Check camera input health without running or returning biometrics."""

    if not face_authentication_lock.acquire(blocking=False):
        response = jsonify(status="UNAVAILABLE", reason="BUSY")
        response.headers["Cache-Control"] = "no-store"
        return response, 503

    try:
        try:
            capture_frame(configured_camera_index())
        except CameraError as error:
            reason = (
                error.reason
                if error.reason in CAMERA_STATUS_REASONS
                else "CAMERA_ERROR"
            )
            response = jsonify(status="UNAVAILABLE", reason=reason)
            response.headers["Cache-Control"] = "no-store"
            return response, 503
        except Exception as error:
            logger.error("Unexpected camera status failure (%s)", type(error).__name__)
            response = jsonify(status="UNAVAILABLE", reason="CAMERA_ERROR")
            response.headers["Cache-Control"] = "no-store"
            return response, 503

        response = jsonify(status="READY")
        response.headers["Cache-Control"] = "no-store"
        return response
    finally:
        face_authentication_lock.release()


@app.post("/face/authenticate")
def authenticate_face() -> tuple[Response, int] | Response:
    lockout_status = face_authentication_lockout.status()
    if lockout_status["status"] == "LOCKED":
        return locked_response(lockout_status)

    if not face_authentication_lock.acquire(blocking=False):
        return jsonify(status="BUSY"), 409

    try:
        # Recheck after acquiring the scan mutex. A request may have observed READY
        # just before another request atomically activated the lockout.
        lockout_status = face_authentication_lockout.status()
        if lockout_status["status"] == "LOCKED":
            return locked_response(lockout_status)

        try:
            result = get_face_engine().recognize()
        except NoFaceError:
            logger.info("Face authentication capture outcome: NO_FACE")
            failure_status = face_authentication_lockout.record_failure()
            if failure_status["status"] == "LOCKED":
                return locked_response(failure_status)
            return (
                jsonify(
                    status="NO_FACE",
                    remainingAttempts=failure_status["remainingAttempts"],
                ),
                422,
            )
        except MultipleFacesError:
            logger.info("Face authentication capture outcome: MULTIPLE_FACES")
            failure_status = face_authentication_lockout.record_failure()
            if failure_status["status"] == "LOCKED":
                return locked_response(failure_status)
            return (
                jsonify(
                    status="MULTIPLE_FACES",
                    remainingAttempts=failure_status["remainingAttempts"],
                ),
                422,
            )
        except FaceEngineError as error:
            logger.error(
                "Face authentication unavailable (%s)", type(error).__name__
            )
            return (
                jsonify(
                    status="UNAVAILABLE",
                    error="Face authentication service is unavailable.",
                ),
                503,
            )
        except Exception as error:
            logger.error(
                "Unexpected face authentication failure (%s)", type(error).__name__
            )
            return (
                jsonify(
                    status="UNAVAILABLE",
                    error="Face authentication service is unavailable.",
                ),
                503,
            )

        if not isinstance(result, RecognitionResult) or type(result.matched) is not bool:
            logger.error("Face engine returned an invalid recognition result")
            return (
                jsonify(
                    status="UNAVAILABLE",
                    error="Face authentication service is unavailable.",
                ),
                503,
            )

        if not result.matched:
            failure_status = face_authentication_lockout.record_failure()
            if failure_status["status"] == "LOCKED":
                return locked_response(failure_status)
            return (
                jsonify(
                    status="NO_MATCH",
                    remainingAttempts=failure_status["remainingAttempts"],
                ),
                401,
            )

        if (
            not isinstance(result.employee_code, str)
            or not result.employee_code
            or type(result.distance) not in (int, float)
            or type(result.threshold) not in (int, float)
            or not math.isfinite(result.distance)
            or not math.isfinite(result.threshold)
        ):
            logger.error("Face engine returned an invalid match result")
            return (
                jsonify(
                    status="UNAVAILABLE",
                    error="Face authentication service is unavailable.",
                ),
                503,
            )

        face_authentication_lockout.reset_failures()
        return jsonify(
            status="MATCH",
            employeeCode=result.employee_code,
            distance=result.distance,
            threshold=result.threshold,
        )
    finally:
        face_authentication_lock.release()


@app.post("/face/register")
def register_face() -> tuple[Response, int] | Response:
    employee_code = normalized_employee_code_from_request()
    if employee_code is None:
        return (
            jsonify(
                status="INVALID_REQUEST",
                error="employeeCode must use 1-64 letters, digits, underscores, or hyphens.",
            ),
            400,
        )

    # Enrollment and authentication share one non-blocking camera mutex. An
    # expected registration outcome never reads or mutates authentication lockout.
    if not face_authentication_lock.acquire(blocking=False):
        return jsonify(status="BUSY"), 409

    try:
        try:
            get_face_engine().register(employee_code)
        except AlreadyRegisteredError:
            logger.info("Face registration outcome: ALREADY_REGISTERED")
            return jsonify(status="ALREADY_REGISTERED"), 409
        except NoFaceError:
            logger.info("Face registration capture outcome: NO_FACE")
            return jsonify(status="NO_FACE"), 422
        except MultipleFacesError:
            logger.info("Face registration capture outcome: MULTIPLE_FACES")
            return jsonify(status="MULTIPLE_FACES"), 422
        except FaceEngineError as error:
            logger.error("Face registration unavailable (%s)", type(error).__name__)
            return (
                jsonify(
                    status="UNAVAILABLE",
                    error="Face registration service is unavailable.",
                ),
                503,
            )
        except Exception as error:
            logger.error("Unexpected face registration failure (%s)", type(error).__name__)
            return (
                jsonify(
                    status="UNAVAILABLE",
                    error="Face registration service is unavailable.",
                ),
                503,
            )

        logger.info("Face registration completed")
        return jsonify(status="REGISTERED", employeeCode=employee_code)
    finally:
        face_authentication_lock.release()


@app.post("/face/registration/status")
def face_registration_status() -> tuple[Response, int] | Response:
    employee_codes = normalized_employee_codes_from_request()
    if employee_codes is None:
        return (
            jsonify(
                status="INVALID_REQUEST",
                error="employeeCodes must contain 1-100 valid employee codes.",
            ),
            400,
        )

    try:
        engine = get_face_engine()
        employees = [
            {
                "employeeCode": employee_code,
                "registered": engine.is_registered(employee_code),
            }
            for employee_code in employee_codes
        ]
    except FaceEngineError as error:
        logger.error(
            "Face registration status unavailable (%s)", type(error).__name__
        )
        return jsonify(status="UNAVAILABLE"), 503
    except Exception as error:
        logger.error(
            "Unexpected face registration status failure (%s)", type(error).__name__
        )
        return jsonify(status="UNAVAILABLE"), 503

    response = jsonify(status="OK", employees=employees)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/unlock")
def unlock() -> tuple[Response, int] | Response:
    if not request.is_json:
        return jsonify(error="Request body must be JSON."), 400

    body: Any = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(error="Request body must be a JSON object."), 400

    slot_number = body.get("slotNumber")
    if type(slot_number) is not int or slot_number not in (1, 2, 3):
        return jsonify(error="slotNumber must be an integer: 1, 2, or 3."), 400

    logger.info("Unlock requested for slot %s", slot_number)

    if MOCK_HARDWARE:
        logger.info("Mock unlock command accepted for slot %s", slot_number)
        return jsonify(
            data={
                "slotNumber": slot_number,
                "status": "UNLOCK_COMMAND_SENT",
                "mockHardware": True,
            }
        )

    if serial_client is None or not serial_client.is_connected:
        logger.error("Serial connection is unavailable")
        return jsonify(error="Serial connection unavailable."), 503

    try:
        with serial_operation_lock:
            serial_client.open_slot(slot_number)
        logger.info("Serial unlock command sent for slot %s", slot_number)
    except SerialClientError as error:
        logger.error("Serial command failed: %s", error)
        return jsonify(error="Serial connection unavailable."), 503
    except Exception:
        logger.exception("Unexpected unlock error")
        return jsonify(error="Internal server error."), 500

    return jsonify(
        data={
            "slotNumber": slot_number,
            "status": "UNLOCK_COMMAND_SENT",
            "mockHardware": False,
        }
    )


def play_audio_asset(asset_path: Path) -> None:
    """Play one trusted local WAV file with a bounded system command."""

    command = list(AUDIO_PLAYER_COMMAND)
    alsa_device = os.getenv("AUDIO_ALSA_DEVICE", "").strip()
    if alsa_device:
        command.extend(("-D", alsa_device))
    command.append(str(asset_path))

    subprocess.run(
        command,
        check=True,
        timeout=AUDIO_PLAYBACK_TIMEOUT_SECONDS,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


@app.post("/audio/play")
def play_audio() -> tuple[Response, int] | Response:
    if not request.is_json:
        return (
            jsonify(status="INVALID_REQUEST", error="Request body must be JSON."),
            400,
        )

    body: Any = request.get_json(silent=True)
    if not isinstance(body, dict) or set(body) != {"event"}:
        return (
            jsonify(
                status="INVALID_REQUEST",
                error="Request body must contain only an audio event.",
            ),
            400,
        )

    event = body.get("event")
    if not isinstance(event, str) or event not in AUDIO_EVENT_FILES:
        return jsonify(status="INVALID_EVENT", error="Unsupported audio event."), 400

    if not audio_playback_lock.acquire(blocking=False):
        return (
            jsonify(
                status="BUSY",
                event=event,
                error="Audio playback is busy.",
            ),
            409,
        )

    try:
        if MOCK_AUDIO:
            logger.info("Mock audio playback accepted for event %s", event)
            return jsonify(status="AUDIO_PLAYED", event=event, mockAudio=True)

        asset_path = AUDIO_ASSET_DIRECTORY / AUDIO_EVENT_FILES[event]
        if not asset_path.is_file():
            logger.error("Audio asset is unavailable for event %s", event)
            return (
                jsonify(
                    status="UNAVAILABLE",
                    event=event,
                    error="Audio playback is unavailable.",
                ),
                503,
            )

        try:
            play_audio_asset(asset_path)
        except (
            FileNotFoundError,
            OSError,
            subprocess.CalledProcessError,
            subprocess.TimeoutExpired,
        ) as error:
            logger.error("Audio playback failed for %s (%s)", event, type(error).__name__)
            return (
                jsonify(
                    status="UNAVAILABLE",
                    event=event,
                    error="Audio playback is unavailable.",
                ),
                503,
            )
        except Exception as error:
            logger.error(
                "Unexpected audio playback failure for %s (%s)",
                event,
                type(error).__name__,
            )
            return (
                jsonify(
                    status="UNAVAILABLE",
                    event=event,
                    error="Audio playback is unavailable.",
                ),
                503,
            )

        logger.info("Audio playback completed for event %s", event)
        return jsonify(status="AUDIO_PLAYED", event=event)
    finally:
        audio_playback_lock.release()


def close_serial_connection() -> None:
    global serial_client

    if serial_client is None:
        return

    try:
        serial_client.close()
        logger.info("Serial connection closed")
    except SerialClientError as error:
        logger.error("Failed to close serial connection: %s", error)
    finally:
        serial_client = None


def main() -> int:
    global serial_client

    try:
        host = os.getenv("PI_UNLOCK_HOST", DEFAULT_HOST)
        service_port = environment_integer("PI_UNLOCK_PORT", DEFAULT_PORT)
        baud_rate = environment_integer("ESP32_BAUD_RATE", DEFAULT_BAUD_RATE)
        camera_index = configured_camera_index()
        logger.info("Face camera configured at index %s", camera_index)

        if MOCK_HARDWARE:
            logger.info("Starting Pi unlock service in mock hardware mode")
        else:
            serial_port = os.getenv("ESP32_SERIAL_PORT")
            if not serial_port:
                raise ValueError(
                    "ESP32_SERIAL_PORT is required unless MOCK_HARDWARE=true."
                )

            logger.info("Connecting to ESP32 on %s at %s baud", serial_port, baud_rate)
            serial_client = Esp32SerialClient(serial_port, baud_rate)
            serial_client.connect()
            logger.info("ESP32 serial connection established")

        atexit.register(close_serial_connection)
        logger.info("Service listening on http://%s:%s", host, service_port)
        app.run(host=host, port=service_port, debug=False, use_reloader=False)
    except (SerialClientError, ValueError, OSError) as error:
        logger.error("Service startup failed: %s", error)
        close_serial_connection()
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
