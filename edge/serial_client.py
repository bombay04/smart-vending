"""Reusable serial client for the Smart Vending Machine ESP32 protocol."""

from __future__ import annotations

from typing import Any


class SerialClientError(Exception):
    """Raised when the serial connection cannot be used."""


class Esp32SerialClient:
    def __init__(
        self,
        port: str,
        baud_rate: int = 115200,
        timeout: float = 1.0,
    ) -> None:
        self.port = port
        self.baud_rate = baud_rate
        self.timeout = timeout
        self._connection: Any | None = None

    @property
    def is_connected(self) -> bool:
        return self._connection is not None and bool(self._connection.is_open)

    def connect(self) -> None:
        if self.is_connected:
            return

        try:
            import serial

            self._connection = serial.Serial(
                port=self.port,
                baudrate=self.baud_rate,
                timeout=self.timeout,
            )
        except Exception as error:
            self._connection = None
            raise SerialClientError(
                f"Unable to open serial port {self.port}: {error}"
            ) from error

    def close(self) -> None:
        if self._connection is None:
            return

        try:
            self._connection.close()
        except Exception as error:
            raise SerialClientError(f"Unable to close serial port: {error}") from error
        finally:
            self._connection = None

    def send_command(self, command: str) -> None:
        normalized_command = command.strip()
        if not normalized_command:
            raise ValueError("Command must not be empty.")

        connection = self._require_connection()

        try:
            connection.write(f"{normalized_command}\n".encode("utf-8"))
            connection.flush()
        except Exception as error:
            raise SerialClientError(f"Unable to send serial command: {error}") from error

    def open_slot(self, slot_number: int) -> None:
        if type(slot_number) is not int or slot_number not in (1, 2, 3):
            raise ValueError("slot_number must be 1, 2, or 3.")

        self.send_command(f"OPEN:{slot_number}")

    def get_status(self) -> None:
        self.send_command("GET_STATUS")

    def ping(self) -> None:
        self.send_command("PING")

    def read_line(self) -> str | None:
        connection = self._require_connection()

        try:
            raw_line = connection.readline()
        except Exception as error:
            raise SerialClientError(f"Unable to read from serial port: {error}") from error

        if not raw_line:
            return None

        line = raw_line.decode("utf-8", errors="replace").strip()
        return line or None

    def classify_message(self, line: str) -> str:
        normalized_line = line.strip()
        if normalized_line in ("READY", "PONG"):
            return normalized_line

        for message_type in ("ACK", "LOCK", "DOOR", "IR", "ERROR"):
            if normalized_line.startswith(f"{message_type}:"):
                return message_type

        return "UNKNOWN"

    def parse_status_line(self, line: str) -> dict[str, str | int] | None:
        parts = line.strip().split(":")
        valid_statuses = {
            "DOOR": {"OPEN", "CLOSED"},
            "IR": {"PRESENT", "EMPTY"},
            "LOCK": {"OPENED", "CLOSED"},
        }

        if (
            len(parts) == 3
            and parts[0] in valid_statuses
            and parts[2] in valid_statuses[parts[0]]
        ):
            try:
                slot_number = int(parts[1])
            except ValueError:
                return None

            if slot_number not in (1, 2, 3):
                return None

            return {"type": parts[0], "slot": slot_number, "status": parts[2]}

        if len(parts) == 3 and parts[0] == "ACK" and parts[1] == "OPEN":
            try:
                slot_number = int(parts[2])
            except ValueError:
                return None

            if slot_number not in (1, 2, 3):
                return None

            return {"type": "ACK", "command": "OPEN", "slot": slot_number}

        if len(parts) == 2 and parts[0] == "ERROR" and parts[1]:
            return {"type": "ERROR", "code": parts[1]}

        return None

    def _require_connection(self) -> Any:
        if not self.is_connected:
            raise SerialClientError("Serial port is not connected.")

        return self._connection
