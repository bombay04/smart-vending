# Pi Local Unlock Service

The Pi Local Unlock Service exposes a small HTTP API on the Raspberry Pi or development PC. It translates an unlock request into an `OPEN:1`, `OPEN:2`, or `OPEN:3` command sent to the ESP32 over USB Serial.

The customer frontend calls this service after a backend purchase succeeds. A successful response means the command was sent; it does not synchronously wait for the ESP32 `ACK` or `ERROR:BUSY` response.

## Install

From the project root:

```bash
python -m pip install -r edge/requirements.txt
```

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ESP32_SERIAL_PORT` | In real mode | None | ESP32 serial port, such as `COM8`, `/dev/ttyUSB0`, or `/dev/ttyACM0`. |
| `ESP32_BAUD_RATE` | No | `115200` | Serial baud rate. |
| `MOCK_HARDWARE` | No | `false` | When `true`, simulate successful unlocks without opening Serial. |
| `PI_UNLOCK_HOST` | No | `127.0.0.1` | Address on which the HTTP service listens. |
| `PI_UNLOCK_PORT` | No | `5000` | HTTP service port. |

The default host accepts requests only from the same machine. Set `PI_UNLOCK_HOST=0.0.0.0` only when LAN access is intentionally required and protected by the local network.

## Mock mode

PowerShell:

```powershell
$env:MOCK_HARDWARE = "true"
python edge/pi_unlock_service.py
```

Linux or Raspberry Pi:

```bash
MOCK_HARDWARE=true python3 edge/pi_unlock_service.py
```

Mock mode does not require an ESP32 or `pyserial` connection.

## Real hardware

Windows PowerShell:

```powershell
$env:ESP32_SERIAL_PORT = "COM8"
python edge/pi_unlock_service.py
```

Raspberry Pi:

```bash
ESP32_SERIAL_PORT=/dev/ttyUSB0 python3 edge/pi_unlock_service.py
```

For a board exposed as a USB CDC device, use `/dev/ttyACM0` instead.

Only one program can normally own the Serial port. Close Arduino Serial Monitor and `serial_test.py` before starting this service.

## API examples

Health check:

```bash
curl http://localhost:5000/health
```

Mock or real unlock request on Linux/Raspberry Pi:

```bash
curl -X POST http://localhost:5000/unlock \
  -H "Content-Type: application/json" \
  -d '{"slotNumber":1}'
```

Windows PowerShell:

```powershell
curl.exe -X POST http://localhost:5000/unlock `
  -H "Content-Type: application/json" `
  -d '{"slotNumber":1}'
```

A successful mock response is:

```json
{
  "data": {
    "slotNumber": 1,
    "status": "UNLOCK_COMMAND_SENT",
    "mockHardware": true
  }
}
```

Invalid JSON, a missing `slotNumber`, or a slot outside `1` through `3` returns HTTP `400`. An unavailable real Serial connection returns HTTP `503`.

`ERROR:BUSY` handling will be added when the service supports synchronously matching ESP32 responses to commands. The current API intentionally reports only that the command was written to Serial.
