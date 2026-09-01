"""Interactive USB Serial test CLI for the Smart Vending Machine ESP32."""

from __future__ import annotations

import argparse
import sys
import threading

from serial_client import Esp32SerialClient, SerialClientError


DEFAULT_BAUD_RATE = 115200
SERIAL_TIMEOUT_SECONDS = 1.0


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Interactively test the Smart Vending Machine ESP32 serial protocol."
    )
    parser.add_argument(
        "--port",
        help="Serial port, for example COM8 or /dev/ttyUSB0",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=DEFAULT_BAUD_RATE,
        help=f"Baud rate (default: {DEFAULT_BAUD_RATE})",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Test protocol parsing without opening a serial port",
    )
    arguments = parser.parse_args()

    if not arguments.self_test and not arguments.port:
        parser.error("--port is required unless --self-test is used")

    return arguments


def read_from_esp32(
    client: Esp32SerialClient,
    stop_event: threading.Event,
) -> None:
    while not stop_event.is_set():
        try:
            message = client.read_line()
        except SerialClientError as error:
            if not stop_event.is_set():
                print(f"\nSerial read error: {error}", file=sys.stderr)
                stop_event.set()
            return

        if message is None:
            continue

        message_type = client.classify_message(message)
        print(f"\nESP32> [{message_type}] {message}")

        if message == "ERROR:BUSY":
            print("WARNING> ESP32 is busy: another lock is currently active.")


def run_interactive_session(client: Esp32SerialClient) -> None:
    stop_event = threading.Event()
    reader = threading.Thread(
        target=read_from_esp32,
        args=(client, stop_event),
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
                client.send_command(command)
            except (SerialClientError, ValueError) as error:
                print(f"Serial write error: {error}", file=sys.stderr)
                break

            print(f"PI> {command}")
    finally:
        stop_event.set()
        reader.join(timeout=SERIAL_TIMEOUT_SECONDS + 0.5)


def run_self_test() -> int:
    client = Esp32SerialClient(port="self-test")
    test_cases: list[tuple[str, str, dict[str, str | int] | None]] = [
        ("READY", "READY", None),
        ("PONG", "PONG", None),
        ("ACK:OPEN:1", "ACK", {"type": "ACK", "command": "OPEN", "slot": 1}),
        ("LOCK:1:OPENED", "LOCK", {"type": "LOCK", "slot": 1, "status": "OPENED"}),
        ("DOOR:1:CLOSED", "DOOR", {"type": "DOOR", "slot": 1, "status": "CLOSED"}),
        ("DOOR:3:OPEN", "DOOR", {"type": "DOOR", "slot": 3, "status": "OPEN"}),
        ("IR:2:EMPTY", "IR", {"type": "IR", "slot": 2, "status": "EMPTY"}),
        ("IR:3:PRESENT", "IR", {"type": "IR", "slot": 3, "status": "PRESENT"}),
        ("ERROR:BUSY", "ERROR", {"type": "ERROR", "code": "BUSY"}),
        ("garbage boot log", "UNKNOWN", None),
    ]

    all_passed = True
    for line, expected_type, expected_data in test_cases:
        actual_type = client.classify_message(line)
        actual_data = client.parse_status_line(line)
        passed = actual_type == expected_type and actual_data == expected_data
        all_passed = all_passed and passed
        result = "PASS" if passed else "FAIL"
        print(f"[{result}] {line} -> {actual_type}, {actual_data}")

    print("Self-test passed." if all_passed else "Self-test failed.")
    return 0 if all_passed else 1


def main() -> int:
    arguments = parse_arguments()

    if arguments.self_test:
        return run_self_test()

    client = Esp32SerialClient(
        port=arguments.port,
        baud_rate=arguments.baud,
        timeout=SERIAL_TIMEOUT_SECONDS,
    )

    try:
        client.connect()
        print(f"Connected to {arguments.port} at {arguments.baud} baud.")
        run_interactive_session(client)
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except SerialClientError as error:
        print(error, file=sys.stderr)
        return 1
    finally:
        try:
            client.close()
        except SerialClientError as error:
            print(error, file=sys.stderr)

    print("Serial connection closed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
