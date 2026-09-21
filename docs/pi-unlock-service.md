# Pi Local Hardware and Face Authentication Service

The Pi local service exposes HTTP APIs for ESP32 vending hardware and employee face authentication. It translates unlock requests into commands sent over USB Serial and runs the local YuNet/SFace recognition engine without sending biometric data off the Pi.

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

Read the current IR product-presence and reed-switch door state:

```bash
curl http://localhost:5000/hardware/status
```

Successful response:

```json
{
  "status": "ok",
  "slots": [
    { "slotNumber": 1, "productPresent": true, "doorClosed": true },
    { "slotNumber": 2, "productPresent": false, "doorClosed": true },
    { "slotNumber": 3, "productPresent": true, "doorClosed": false }
  ]
}
```

In real mode, the service sends `GET_STATUS` and waits up to three seconds for both `IR` and `DOOR` state for all three slots. Unrelated Serial lines are ignored. Missing, incomplete, timed-out, or disconnected hardware status returns HTTP `503`; the service never invents missing sensor values.

In mock mode, all three slots deterministically report `productPresent: true` and `doorClosed: true`.

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

## Face authentication

Start one bounded employee face scan:

```bash
curl -X POST http://localhost:5000/face/authenticate
```

The service lazily initializes one `FaceEngine` and reuses its YuNet/SFace runtime for later requests. Recognition retains the engine's schema-v3 templates, default `1.128` SFace L2 threshold, three live samples, all-samples-pass consensus, ambiguous-candidate rejection, and bounded capture retries.

Responses are:

| HTTP | Status | Meaning |
| --- | --- | --- |
| `200` | `MATCH` | One template matched; response also contains `employeeCode`, `distance`, and `threshold`. |
| `401` | `NO_MATCH` | Recognition completed but did not produce one unambiguous match. |
| `422` | `NO_FACE` | No usable face was captured within the bounded retries. |
| `422` | `MULTIPLE_FACES` | More than one face remained visible within the bounded retries. |
| `409` | `BUSY` | Another face-authentication request owns the camera. |
| `503` | `UNAVAILABLE` | Camera, model, template, runtime, or another operational dependency failed. |

A successful match has this shape:

```json
{
  "status": "MATCH",
  "employeeCode": "EMP001",
  "distance": 0.437637,
  "threshold": 1.128
}
```

Only one face scan can run at a time. The endpoint never returns embeddings, template contents, images, aligned crops, or landmarks. `employeeCode` is only a recognition result; the backend `/api/v1/employees/auth/face` endpoint must still validate that the employee exists and is active before Restock Mode is authorized.

`ERROR:BUSY` handling will be added when the service supports synchronously matching ESP32 responses to commands. The current API intentionally reports only that the command was written to Serial.
