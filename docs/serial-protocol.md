# ESP32 Serial Protocol

This protocol is used for manual USB Serial communication between a PC or Raspberry Pi and the Smart Vending Machine ESP32.

The behavior below is based on the inspected firmware and Pi source. The project owner confirms developing and flashing the ESP32 firmware, but an exact match between this repository file and the last flashed version has not been independently verified.

## Connection settings

- Baud rate: `115200`
- Line ending: newline (`\n`)
- Encoding: UTF-8

## Pi to ESP32 commands

| Command | Meaning |
| --- | --- |
| `PING` | Check whether the ESP32 is responding; it replies `PONG`. |
| `GET_STATUS` | Request the current door and IR sensor status for Slots 1–3. |
| `OPEN:1` | Open the lock for Slot 1. |
| `OPEN:2` | Open the lock for Slot 2. |
| `OPEN:3` | Open the lock for Slot 3. |

Every command must end with `\n`.

`GET_STATUS` returns six lines: `DOOR:n:...` then `IR:n:...` for each slot `n` from 1 to 3. It does not return `LOCK` status. The Pi hardware status collector waits for both `DOOR` and `IR` readings for all three slots.

## ESP32 to Pi responses

| Response | Meaning |
| --- | --- |
| `READY` | The ESP32 is initialized and ready. |
| `PONG` | Response to `PING`. The Pi serial CLI classifies it as `PONG`. |
| `ACK:OPEN:1` | The ESP32 accepted the open command for Slot 1. Slots 2 and 3 use the same format. |
| `LOCK:1:OPENED` | Slot 1's relay was activated for the unlock pulse; this does not confirm physical lid movement. |
| `LOCK:1:CLOSED` | Slot 1's relay pulse ended and its relay was turned off; this is separate from the reed-switch door state. |
| `DOOR:1:OPEN` | Door 1 is open. |
| `DOOR:1:CLOSED` | Door 1 is closed. |
| `IR:1:PRESENT` | The IR sensor detects a product in Slot 1. |
| `IR:1:EMPTY` | The IR sensor reports that Slot 1 is empty. |
| `ERROR:INVALID_SLOT` | The requested slot number is invalid. |
| `ERROR:UNKNOWN_COMMAND` | The ESP32 does not recognize the command. |
| `ERROR:BUSY` | Another lock operation is active, so the ESP32 cannot accept a new open command yet. |

Slot responses use the same format for Slots 2 and 3.

## Install and run

From the project root, create and activate a Python virtual environment if desired, then install the dependency:

```bash
python -m pip install -r edge/requirements.txt
```

Windows example:

```powershell
python edge/serial_test.py --port COM8
```

Raspberry Pi examples:

```bash
python3 edge/serial_test.py --port /dev/ttyUSB0
python3 edge/serial_test.py --port /dev/ttyACM0
```

Use `--baud` only when testing a firmware configuration that differs from the default:

```bash
python edge/serial_test.py --port COM8 --baud 115200
```

## Example manual test session

The sensor values below are illustrative; they are not measurements from the cabinet.

```text
Connected to COM8 at 115200 baud.
Type a protocol command, or type 'exit'/'quit' to stop.

ESP32> [READY] READY
PING
PI> PING
ESP32> [PONG] PONG
GET_STATUS
PI> GET_STATUS
ESP32> [DOOR] DOOR:1:OPEN
ESP32> [IR] IR:1:EMPTY
ESP32> [DOOR] DOOR:2:CLOSED
ESP32> [IR] IR:2:PRESENT
ESP32> [DOOR] DOOR:3:CLOSED
ESP32> [IR] IR:3:PRESENT
OPEN:1
PI> OPEN:1

ESP32> [ACK] ACK:OPEN:1
ESP32> [LOCK] LOCK:1:OPENED
quit
Serial connection closed.
```

If the ESP32 replies with `ERROR:BUSY`, wait until the active lock cycle completes before sending another `OPEN` command.
