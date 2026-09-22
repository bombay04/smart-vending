# Pi Local Hardware and Face Service

The Pi local service exposes HTTP APIs for ESP32 vending hardware, employee face authentication, and prototype employee face registration. It translates unlock requests into commands sent over USB Serial and runs the local YuNet/SFace engine without sending biometric data off the Pi.

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
| `401` | `NO_MATCH` | Recognition completed without one unambiguous match; counted failure with `remainingAttempts`. |
| `422` | `NO_FACE` | No usable face was captured within the bounded retries; counted failure with `remainingAttempts`. |
| `422` | `MULTIPLE_FACES` | More than one face remained visible within the bounded retries; counted failure with `remainingAttempts`. |
| `409` | `BUSY` | Another face-authentication request owns the camera. |
| `423` | `LOCKED` | Three counted failures occurred; no camera or recognition work was attempted. Response contains `retryAfterSeconds`. |
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

`NO_MATCH`, `NO_FACE`, and `MULTIPLE_FACES` each count once per completed `POST /face/authenticate`, regardless of the bounded internal capture retries. `BUSY`, `UNAVAILABLE`, malformed/internal errors, and requests that do not complete do not count. A valid `MATCH` resets the accumulated failures. The third counted failure returns:

```json
{
  "status": "LOCKED",
  "retryAfterSeconds": 180
}
```

Further authentication requests return HTTP `423` immediately and do not initialize or invoke `FaceEngine`. The remaining time is determined with a monotonic clock. After 180 seconds the failure count resets and the next request may scan.

The frontend can safely read the current authority state without scanning:

```bash
curl http://localhost:5000/face/auth/status
```

An unlocked response contains `status: "READY"`, `failedAttempts`, and `remainingAttempts`. A locked response contains `status: "LOCKED"` and `retryAfterSeconds`. The frontend checks this endpoint when Employee Mode opens and after its display countdown reaches zero, so navigation or browser refresh cannot bypass an active Pi lockout. The countdown is informational; the Pi remains authoritative.

Lockout state is concurrency-safe but exists only in Pi service process memory. Restarting the service clears it. This is an accepted prototype limitation; nothing is persisted to the backend, browser storage, or biometric template files.

Only one face operation can run at a time. Authentication and registration share the same non-blocking camera mutex. The endpoint never returns embeddings, template contents, images, aligned crops, or landmarks. `employeeCode` is only a recognition result; the backend `/api/v1/employees/auth/face` endpoint must still validate that the employee exists and is active before Restock Mode is authorized.

## Employee face registration

The Admin prototype UI is reached by direct navigation to `/admin/face-registration`; it is not linked from Customer Home. It loads its selection list from:

```text
GET /api/v1/employees/face-registration
```

The backend response is `{ "employees": [...] }`, where each entry contains only `id`, `employeeCode`, `name`, and `isActive`. Active and inactive employees are shown, but inactive employees cannot start registration. The backend query and response mapper do not select or return `faceEmbedding` or another biometric field.

The UI then asks the Pi for local registration existence:

```text
POST /face/registration/status
Content-Type: application/json

{"employeeCodes":["EMP001","EMP002"]}
```

The request accepts 1–100 valid employee codes, trims and uppercases them, and removes duplicates. HTTP `200` returns `{ "status": "OK", "employees": [{ "employeeCode": "EMP001", "registered": true }] }` with `Cache-Control: no-store`. A valid code with no local template, including a code unknown to the Pi, returns `registered: false`. Invalid input returns HTTP `400 INVALID_REQUEST`; template/model/runtime failure returns HTTP `503 UNAVAILABLE`. This endpoint returns no paths, model metadata, template contents, embeddings, images, crops, landmarks, or detections.

After an active employee is selected, the UI revalidates through the backend before capture:

```text
POST /api/v1/employees/face-registration/validate
Content-Type: application/json

{"employeeCode":"EMP001"}
```

The backend uses its authoritative employee record. HTTP `200` returns only `{ "employee": { "id", "name", "employeeCode" } }` for an existing active employee. A missing or inactive employee returns HTTP `401`; malformed input returns HTTP `400`; an operational failure fails closed. This manual-code validation endpoint remains available for existing tooling, but it is not the primary admin UX. No biometric value is read or written by either backend endpoint.

After a successful backend validation, the UI starts local enrollment:

```bash
curl -X POST http://localhost:5000/face/register \
  -H "Content-Type: application/json" \
  -d '{"employeeCode":"EMP001"}'
```

The Pi normalizes the code again, then calls the existing `FaceEngine.register` path. Enrollment uses the existing YuNet single-face validation, SFace embedding generation, bounded retries, camera stabilization, and five independent valid captures. Each accepted capture must contain exactly one face. The resulting schema-v3 JSON template is atomically created under `edge/face/data/templates/`; an existing file is never replaced.

Responses are deliberately bounded and contain no biometric material:

| HTTP | Status | Meaning |
| --- | --- | --- |
| `200` | `REGISTERED` | Template created; response contains normalized `employeeCode`. |
| `400` | `INVALID_REQUEST` | JSON or `employeeCode` is missing or violates the existing 1–64 character template identifier rule. |
| `409` | `ALREADY_REGISTERED` | A template already exists; no capture occurs and no file is replaced. |
| `409` | `BUSY` | Authentication or another registration request owns the camera. |
| `422` | `NO_FACE` | A valid enrollment sample could not be collected within bounded retries; the admin may retry. |
| `422` | `MULTIPLE_FACES` | More than one face remained visible within bounded retries; the admin may retry. |
| `503` | `UNAVAILABLE` | Camera, model, storage, runtime, or another operational dependency failed. |

Registration does not read, increment, reset, or bypass face-authentication `failedAttempts` or lockout state. A successfully registered employee is recognized through the unchanged `POST /face/authenticate` route; the backend still performs active-employee validation after a match.

Frames are processed in memory and are not persisted. HTTP bodies and service logs do not include captured images, crops, landmarks, detections, embeddings, template paths, model data, or template contents. Models and templates remain in the Git-ignored `edge/face/data/` directory. Registration-existence booleans remain Pi-authoritative and are not persisted in the backend.

Prototype limitations: this UI does not yet include a separate admin sign-in/authorization mechanism, employee validation and capture are two frontend-orchestrated requests rather than one backend-issued enrollment grant, and aborting browser navigation does not cancel a capture already running in the Pi process. Enrollment has automated coverage but has not been claimed as validated on physical Raspberry Pi camera hardware by Task 37.

`ERROR:BUSY` handling will be added when the service supports synchronously matching ESP32 responses to commands. The current API intentionally reports only that the command was written to Serial.
