"""Local HTTP service that sends unlock commands to the vending ESP32."""

from __future__ import annotations

import atexit
import logging
import os
import threading
import time
from typing import Any

from flask import Flask, Response, jsonify, request

from serial_client import Esp32SerialClient, SerialClientError


DEFAULT_BAUD_RATE = 115200
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000
ALLOWED_ORIGIN = "http://localhost:5173"
HARDWARE_STATUS_TIMEOUT_SECONDS = 3.0

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("pi-unlock-service")

app = Flask(__name__)
serial_client: Esp32SerialClient | None = None
serial_operation_lock = threading.Lock()


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


MOCK_HARDWARE = environment_flag("MOCK_HARDWARE")


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
