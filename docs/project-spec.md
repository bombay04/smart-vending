# Smart Vending Machine Prototype — Project Specification

This document is the canonical high-level source of truth for the Smart Vending Machine internship prototype. It records the agreed architecture, business rules, scope, and known implementation status. Technical documents provide implementation detail, but they must not silently override this specification. When lower-level documentation or code differs from this document, the difference must be recorded and resolved explicitly.

## Status language

- **Implemented/validated** means the behavior is supported by current repository code or by the agreed project validation record.
- **Required/pending** means the behavior is part of the prototype scope but is not proven complete by the current repository.
- **Out of scope** means the behavior is not required for Phase 1.

## Project and physical machine

The project is a Smart Vending Machine prototype for an internship demonstration.

The physical machine is one vending cabinet with three transparent, stacked acrylic compartments. Each compartment is a slot with a front lid monitored by a magnetic reed sensor.

| Slot | Product |
| --- | --- |
| 1 | Tissue |
| 2 | Sanitary Pad |
| 3 | Wet Wipes |

## Non-negotiable business rules

1. Payment success completes a sale immediately.
2. The purchased slot becomes `SOLD_OUT` as part of the successful sale transition.
3. Physical removal of the product, including IR confirmation, is not required to finalize a sale.
4. A `SOLD_OUT` product cannot be selected.
5. Restocking restores all three slots to `AVAILABLE`; Phase 1 does not support partial restock.
6. Restock Mode is available only after local face matching and authoritative backend validation of an active employee.
7. Employee authentication fails closed for every unsuccessful, unavailable, malformed, or uncertain outcome.
8. Biometric data remains local to the Raspberry Pi. The backend and frontend must never receive biometric embeddings.

## System architecture and responsibilities

### ESP32

The ESP32 controls three relay/solenoid lock outputs, reads three IR product sensors, and reads three reed lid/door sensors. These responsibilities and their physical hardware behavior are **completed/externally hardware-validated** based on project test history. The current repository has no tracked ESP32 firmware or hardware-test evidence, so that validation cannot be independently reproduced from the currently tracked artifacts.

### Raspberry Pi 3B+

The Raspberry Pi hosts the touchscreen Chromium browser, USB webcam, speaker/audio output, local face recognition, and the Pi HTTP hardware service. It calls the backend over HTTP and communicates with the ESP32 through a USB serial bridge.

### Backend

The backend uses Node.js, TypeScript, Express, PostgreSQL, and Prisma. It provides the REST API and owns authoritative business data, including inventory, employees, transactions, and restock logs. Real Omise/Opn payment integration and LINE notification integration belong here or behind backend-controlled integrations.

### Frontend

The touchscreen UI uses React, Vite, and TypeScript and runs in Chromium on the Raspberry Pi.

## Communication boundaries

| Link | Protocol and purpose |
| --- | --- |
| Frontend ↔ Backend | HTTP for products, inventory, employee validation, payment/sale, and restock business operations |
| Frontend ↔ Pi local service | HTTP for hardware-local operations such as face scanning, slot status, and unlock requests |
| Pi ↔ Backend | HTTP where Pi-originated backend communication is required |
| Pi ↔ ESP32 | USB serial at 115200 baud, UTF-8, LF-terminated messages |

The complete serial interface control document is [serial-protocol.md](serial-protocol.md).

The following messages have different meanings and must never be treated as equivalent:

- `LOCK:n:CLOSED` means the solenoid unlock period has ended.
- `DOOR:n:CLOSED` means the reed sensor reports that the physical lid is closed.

## Customer purchase flow

The required customer flow is:

`Home → show product availability → select an AVAILABLE product → QR payment → payment success → complete sale and mark the selected slot SOLD_OUT → unlock the selected physical slot → Thank You → Home`

The payment-success transition is authoritative. Unlocking follows that transition, and an unlock failure must not reverse or defer the completed sale. The system does not wait for the IR sensor to report product removal.

The implemented provider is Omise/Opn Payments using PromptPay QR. The backend creates the PromptPay source and charge together from the database-owned slot, product, and decimal price; it converts THB to integer satang without floating-point arithmetic. Provider secrets remain backend-only. The browser receives only the local transaction identifier, customer-facing purchase data, the provider QR image URL, status, and expiry.

Payment authority flows `Omise/Opn → backend reconciliation → local Transaction state`. A signed `charge.complete` webhook can trigger reconciliation on a deployed backend, and the frontend polls the local backend status endpoint so local development does not depend on public webhook delivery. In both paths the backend retrieves the stored Opn charge with its secret key and verifies its identifier, THB amount, currency, paid flag, and status; the webhook body or browser never declares success.

Provider-confirmed success atomically changes the transaction to `SUCCESS` and the selected slot to `SOLD_OUT`. Repeated polling and duplicate webhook delivery are idempotent. Only after observing backend-confirmed success does the Pi-hosted frontend call the local `POST /unlock` endpoint with `{ "slotNumber": n }`. Unlock failure displays a staff-contact message and never reverses the successful transaction, restores inventory, or triggers an automatic refund.

Automated tests cover the provider boundary and customer flow with mocked provider responses. Real PromptPay end-to-end payment, webhook delivery, account enablement, and physical bank-app validation still require an Opn test/live account and deployment-specific validation; they are not claimed as physically validated.

## Inventory

Customer-visible inventory has exactly two states:

- `AVAILABLE`
- `SOLD_OUT`

A successful sale changes only the purchased slot to `SOLD_OUT`. A successful restock changes Slots 1–3 to `AVAILABLE`. Sensor readings support physical validation but do not replace the backend inventory state and do not determine whether a paid sale is complete.

The two-state inventory model, sold-out selection guard, provider-confirmed sale transition, and all-slot restock transition are **implemented**.

## Employee authentication flow

The required employee flow is:

`Home → Employee Mode → face authentication on Pi → backend validates matched employee exists and is active → Restock Mode`

The Pi returns `employeeCode` only after a successful local biometric match. That result alone does not authorize Restock Mode. The backend remains authoritative for employee existence and active status.

Authentication must fail closed. None of the following may grant access: `NO_MATCH`, `NO_FACE`, `MULTIPLE_FACES`, scanner `BUSY`, Pi unavailability, camera or model failure, invalid responses, backend failure, an unknown employee, or an inactive employee.

Employee authentication state must remain in application memory and must not be persisted in `localStorage` or `sessionStorage`. It must be cleared when the employee cancels or exits, when restock completes successfully, and whenever the application returns to the customer flow.

Local face scanning, backend active-employee validation, fail-closed error handling, and memory-only frontend authentication are **implemented**. The target behavior is to clear authentication immediately once a successful restock is committed. The current UI instead retains the authenticated employee in memory during the approximately 3.5-second success screen and clears it when returning to Customer Home. This is a known implementation discrepancy; no application change is made by this specification.

### Face-authentication lockout

The three-failure, three-minute employee face-authentication lockout is **implemented**. The Raspberry Pi service is authoritative: each completed `NO_MATCH`, `NO_FACE`, or `MULTIPLE_FACES` HTTP authentication operation counts once, while internal capture retries do not count separately. `BUSY`, `UNAVAILABLE`, malformed/internal errors, and network failures do not count. A valid `MATCH` resets prior failures.

The third counted failure starts a 180-second lockout immediately. While locked, the Pi returns HTTP `423` with `status: "LOCKED"` and a positive `retryAfterSeconds` without opening the camera or running face recognition. Lockout state uses a monotonic clock and concurrency-safe process memory. It therefore survives frontend navigation and browser refresh but resets if the Pi service process restarts; persistent or distributed rate limiting is outside the prototype scope.

## Face recognition and biometric privacy

The current Raspberry Pi prototype uses:

- OpenCV YuNet for face detection;
- OpenCV SFace for recognition;
- schema-v3 local templates;
- five enrollment samples;
- three live recognition samples;
- the median distance across enrollment samples for each live sample;
- an all-live-samples-must-pass decision;
- OpenCV `FR_NORM_L2`; and
- a current prototype threshold of `1.128`.

The `1.128` threshold originated as an upstream/reference threshold and was initially uncalibrated for this project. Task 34 subsequently validated it on the prototype dataset with the following results:

- one enrolled employee;
- 15 of 15 genuine live samples accepted;
- worst observed genuine sample distance: `0.829017`;
- two impostor subjects;
- 18 of 18 impostor live samples rejected;
- closest observed impostor sample distance: `1.203603`; and
- no observed overlap between genuine and impostor samples.

Based on that validation, `1.128` is accepted as the current prototype threshold. This limited prototype result is not production biometric calibration and is not a general biometric security guarantee. If [pi-face-recognition.md](pi-face-recognition.md) describes the threshold only as uncalibrated, that technical document is stale relative to the Task 34 result and this canonical specification.

Face templates and ONNX models stay local on the Pi under `edge/face/data/`, which must remain ignored by Git. The system must not store or transmit raw face images, aligned crops, embeddings/templates, or landmarks. In particular, biometric templates and embeddings remain exclusively local to the Raspberry Pi and must never reach the backend or frontend.

The optional `Employee.faceEmbedding` field still present in the backend Prisma schema is legacy backend schema technical debt. The current architecture must not use or populate it. Removing the legacy field requires a separate schema/migration task and is not part of this documentation change.

The YuNet/SFace pipeline, sampling and comparison rules, schema-v3 storage, local Pi HTTP endpoint, privacy-safe response shape, and Git ignore rule are **implemented**. See [pi-face-recognition.md](pi-face-recognition.md) and [pi-unlock-service.md](pi-unlock-service.md) for technical operation details.

### Employee face registration

Task 37 uses two deliberately separate prototype surfaces:

- `/staff` is the cloud employee-management portal. It lists backend employee records and creates an employee from a name only. The backend allocates sequential `EMP###` codes, marks new employees active, and initializes `faceRegistered: false`. This portal never calls the Pi service and has no camera or face-scan action.
- `/admin/face-registration` is the vending-machine-local face-setup UI. It combines cloud employee metadata with Pi-local template existence, blocks inactive employees, revalidates active status, and enrolls through the Pi camera.

The local enrollment flow is:

`Direct navigation to /admin/face-registration → load backend employee list → combine it with Pi-local registered/unregistered status → select employee → backend revalidates active status → ready state → Pi captures five valid samples → schema-v3 template saved locally → frontend reports non-biometric completion metadata to backend`

Neither route is linked or otherwise exposed from Customer Home, and local face setup returns to Customer Home. Production staff/admin authentication and authorization remain out of scope; route separation is an interface boundary, not an access-control mechanism.

The backend is authoritative for employee identity and active status. `POST /api/v1/employees` accepts exactly `{ "name": string }`; clients cannot supply an employee code, active flag, registration flag, or biometric field. Code allocation runs in a serializable transaction and retries uniqueness/serialization conflicts. `GET /api/v1/employees/face-registration` returns only `id`, `employeeCode`, `name`, `isActive`, and `faceRegistered`. `POST /api/v1/employees/face-registration/validate` remains the final active-employee check before capture and returns only `id`, `name`, and normalized `employeeCode`; unknown and inactive employees fail closed. Inactive employees remain visible but cannot be selected for enrollment.

The Pi alone is authoritative for actual template existence. `POST /face/registration/status` accepts a bounded list of employee codes and returns only normalized codes with `registered: true|false`. The backend `faceRegistered` Boolean is non-biometric, last-reported workflow metadata for the cloud staff portal; it is not proof that a usable template exists on a particular Pi. The local UI joins both values, so a Pi template with stale backend metadata becomes `Status Sync Required`, while backend metadata without a local template becomes `Local Setup Required`. If Pi status is unavailable, the list remains usable with an explicit unknown state; the non-overwriting registration endpoint remains the final protection.

After the Pi returns `REGISTERED`, the frontend calls `POST /api/v1/employees/face-registration/complete` with exactly `{ "employeeCode": string }`. The backend again requires an existing active employee and updates only `faceRegistered`. It rejects extra fields, including any biometric payload. If this metadata call fails after local enrollment, the template remains on the Pi and the UI offers sync-only recovery. A retry does not recapture or overwrite the template; `ALREADY_REGISTERED` also routes a stale record to the same sync-only state.

The frontend visibly separates employee-list loading, empty list, backend unavailable, Pi-status unavailable, validation, ready, capture, metadata sync, sync failure, success, `NO_FACE`, `MULTIPLE_FACES`, `ALREADY_REGISTERED`, camera `BUSY`, and Pi unavailable states.

The Pi is authoritative for biometric enrollment and calls the same Task 34 `FaceEngine`, YuNet detector, SFace embedder, validation rules, five-sample default, and schema-v3 `TemplateStore`. It does not invoke a subprocess or create a second enrollment pipeline. An existing template returns explicit `ALREADY_REGISTERED` and is never silently overwritten; replacement and re-enrollment are out of scope.

Registration and authentication share one camera mutex, so simultaneous operations fail safely with `BUSY`. Registration outcomes never mutate authentication failure or lockout state. After registration, the unchanged `/face/authenticate` flow reads the new local template; backend validation remains required before Restock Mode.

Only normalized employee codes and registration-existence booleans cross the Pi registration HTTP boundary. The backend stores only the non-biometric Boolean `faceRegistered`; it never receives evidence, embeddings, measurements, paths, or template contents. Frames, detections, aligned crops, landmarks, embeddings, template paths, model data, and template contents are neither returned nor sent to the backend/frontend; original captures are not persisted. Runtime templates remain under Git-ignored `edge/face/data/` storage.

Task 37 is a prototype staff/admin flow, not a production HR system or enrollment station: it has no separate staff/admin authorization, employee edit/deactivate/delete UI, liveness/anti-spoofing, multi-Pi metadata reconciliation, or replacement workflow, and no server-side cancellation of a capture already started when the browser leaves. Backend validation, Pi capture, and completion metadata are sequential frontend-orchestrated calls, so an employee status change between those calls is not transactionally locked. Automated tests cover the flow; real Raspberry Pi camera validation has not been recorded for this task.

## Restock flow

An employee enters Restock Mode only after successful authentication. Confirm Restock is disabled until all three slots are ready.

Each slot is ready only when all of these conditions hold:

- the IR sensor reports `PRESENT`;
- the reed/door sensor reports `CLOSED`; and
- `CLOSED` has remained stable for at least two seconds.

An `OPEN` reading resets that slot's stable-closed timer. An `EMPTY` reading makes the slot not ready immediately. Hardware unavailability clears readiness.

When all three slots are ready, the required completion flow is:

`employee confirms restock → create RestockLog → set all three inventory slots AVAILABLE → send LINE restock notification → clear employee authentication → return to customer flow`

Three-slot sensor readiness, the two-second stable-closed rule, readiness clearing on hardware failure, confirmation gating, `RestockLog` creation, and the all-slot `AVAILABLE` transition are **implemented** in the current frontend/backend flow. The current endpoint remains named and described as a mock restock endpoint, and the backend trusts the frontend's readiness gate rather than independently receiving sensor proof. LINE notification is **required/pending**.

## Unlock and hardware status behavior

The Pi HTTP service exposes hardware status and unlock operations and translates them to the serial protocol. Its current unlock success response means that the serial command was written; it does not mean the ESP32 acknowledged the command or that the physical lid opened.

Full Pi service behavior and operational constraints are documented in [pi-unlock-service.md](pi-unlock-service.md). End-to-end setup and verification procedures are documented in [full-system-test-guide.md](full-system-test-guide.md).

## Notifications

A LINE notification is required after both:

- a successful restock; and
- a successful sale.

Neither notification path is proven by the current repository. Both are **required/pending**.

## Hardware stability and reset classification

During an earlier PCB migration, electrical noise caused false IR/reed events and ESP32 resets. Hardware mitigation and regression testing were **completed/externally hardware-validated** as part of project test history. This is completed work, not an unfinished project requirement.

Ordinary sensor transitions must not be classified as ESP32 resets. A reset claim requires reset or boot evidence, such as ESP32 boot/reset logs, a serial reconnect, or observed state reinitialization.

The current repository does not contain the mitigation design record or regression-test evidence, so the completed external validation cannot be independently verified from the currently tracked repository artifacts.

## Audio

Raspberry Pi audio/voice output is required prototype scope and is planned for Task 39. It is **required/pending**; the current repository contains no verified implementation.

## Phase 1 exclusions

The following are out of scope for Phase 1:

- MQTT;
- a mobile application;
- liveness detection or anti-spoofing;
- automatic refunds;
- offline synchronization;
- OTA firmware updates;
- Kubernetes;
- microservices;
- an advanced monitoring dashboard; and
- production biometric calibration.

## Implementation summary

| Capability | Status |
| --- | --- |
| Three-slot product mapping and two-state inventory | Implemented |
| ESP32 lock outputs and IR/reed sensor behavior | Completed/externally hardware-validated; tracked evidence unavailable |
| Provider-confirmed successful-sale transition and sold-out selection guard | Implemented (automated tests; real provider E2E pending) |
| Pi-local unlock request after backend-confirmed payment | Implemented |
| Real Omise/Opn PromptPay QR creation, polling, and webhook reconciliation | Implemented (automated tests; real provider E2E pending) |
| Local YuNet/SFace recognition and Pi face-auth HTTP endpoint | Implemented |
| Cloud employee management plus active-employee local face registration | Implemented (automated tests; physical Task 37 validation not recorded) |
| Backend validation of matched active employee | Implemented |
| Fail-closed employee-auth outcomes | Implemented |
| Three-slot restock readiness and stable-closed gating | Implemented |
| Restock log and all-slot inventory reset | Implemented through mock-named endpoint |
| Three-failure, three-minute face-auth lockout | Implemented |
| LINE notification after sale | Required/pending |
| LINE notification after restock | Required/pending |
| Raspberry Pi audio/voice | Required/pending (Task 39) |
| PCB-noise mitigation and hardware regression | Completed/externally hardware-validated; tracked evidence unavailable |

## Known technical debt and implementation discrepancies

1. **Legacy backend biometric field:** `backend/prisma/schema.prisma` still defines an optional `Employee.faceEmbedding` JSON field. The current architecture must neither use nor populate it; new employee creation leaves it `NULL`, API selects omit it, and biometric templates and embeddings remain exclusively local to the Pi. Removing it is deferred to a separate schema/migration task. The separate `faceRegistered` Boolean is privacy-safe workflow metadata and is not biometric template authority.
2. **Stale threshold documentation:** [pi-face-recognition.md](pi-face-recognition.md) still describes `1.128` only as an upstream reference that is uncalibrated for this project. Task 34 later validated it for the limited prototype dataset described above. The technical document is stale; the Task 34 result is not a business-rule conflict.
3. **Delayed authentication clearing:** after a successful restock is committed, the current frontend retains the authenticated employee in memory during the approximately 3.5-second success screen. It clears authentication when returning to Customer Home, while the target behavior is immediate clearing at successful commit.

## Technical references

- [ESP32 serial protocol](serial-protocol.md)
- [Raspberry Pi face recognition](pi-face-recognition.md)
- [Pi local hardware and face-authentication service](pi-unlock-service.md)
- [Omise/Opn PromptPay integration](opn-payments.md)
- [Full-system test guide](full-system-test-guide.md)
