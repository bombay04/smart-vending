"""Interactive USB Serial test client for the Smart Vending Machine ESP32."""

from __future__ import annotations

import argparse
import sys
import threading

import serial
from serial import SerialException


DEFAULT_BAUD_RATE = 115200
SERIAL_TIMEOUT_SECONDS = 1
MESSAGE_TYPES = ("ACK", "LOCK", "DOOR", "IR", "ERROR")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Interactively test the Smart Vending Machine ESP32 serial protocol."
    )
    parser.add_argument(
        "--port",
        required=True,
        help="Serial port, for example COM8 or /dev/ttyUSB0",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=DEFAULT_BAUD_RATE,
        help=f"Baud rate (default: {DEFAULT_BAUD_RATE})",
    )
    return parser.parse_args()


def classify_message(message: str) -> str:
    if message == "READY":
        return "READY"

    for message_type in MESSAGE_TYPES:
        if message.startswith(f"{message_type}:"):
            return message_type

    return "UNKNOWN"


def read_from_esp32(
    connection: serial.Serial,
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set():
        try:
            raw_line = connection.readline()
        except (SerialException, OSError) as error:
            if not stop_event.is_set():
                print(f"\nSerial read error: {error}", file=sys.stderr)
                stop_event.set()
            return

        if not raw_line:
            continue

        message = raw_line.decode("utf-8", errors="replace").strip()
        if not message:
            continue

        message_type = classify_message(message)
        print(f"\nESP32> [{message_type}] {message}")

        if message == "ERROR:BUSY":
            print("WARNING> ESP32 is busy: another lock is currently active.")


def run_interactive_session(connection: serial.Serial) -> None:
    stop_event = threading.Event()
    reader = threading.Thread(
        target=read_from_esp32,
        args=(connection, stop_event),
        daemon=True,
        name="esp32-serial-reader",
    )
    reader.start()

    print("Type a protocol command, or type 'exit'/'quit' to stop.")

    try:
        while not stop_event.is_set():
            try:
                command = input().strip()
            except EOFError:
                break

            if not command:
                continue

            if command.lower() in {"exit", "quit"}:
                break

            try:
                connection.write(f"{command}\n".encode("utf-8"))
                connection.flush()
            except (SerialException, OSError) as error:
                print(f"Serial write error: {error}", file=sys.stderr)
                break

            print(f"PI> {command}")
    finally:
        stop_event.set()
        reader.join(timeout=SERIAL_TIMEOUT_SECONDS + 0.5)


def main() -> int:
    arguments = parse_arguments()

    try:
        with serial.Serial(
            port=arguments.port,
            baudrate=arguments.baud,
            timeout=SERIAL_TIMEOUT_SECONDS,
        ) as connection:
            print(f"Connected to {arguments.port} at {arguments.baud} baud.")
            run_interactive_session(connection)
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except (SerialException, OSError) as error:
        print(
            f"Unable to use serial port {arguments.port}: {error}",
            file=sys.stderr,
        )
        return 1

    print("Serial connection closed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
