# Task 56 — power loss and reboot acceptance preparation

**Status:** preparation only, 12 October 2026. No Raspberry Pi, ESP32, relay, payment provider, backend service, database, or live inventory was operated in this task. Physical results for 56-A through 56-G are **NOT TESTED**. This is the local deployment; Cloud operation is outside scope.

Repository baseline: branch `feat/task56-power-reboot-acceptance`; `PROJECT_CONTEXT.md` was already untracked and was neither read, edited, nor staged. Task 55's source-of-truth document is present.

## Evidence levels and recovery architecture

- **Source reviewed:** The PC runs the Express backend and PostgreSQL in Docker. Backend reconciliation of an Opn test charge makes a transaction `SUCCESS` and its slot `SOLD_OUT` in one serializable database transaction. A repeated `SUCCESS` is returned without a second slot update. The backend is authoritative for payment and slot status; it does not record whether a physical unlock completed. See [transaction service](../backend/src/services/transaction.service.ts), [schema](../backend/prisma/schema.prisma), and [payment guide](opn-payments.md).
- **Source reviewed:** On the Pi, separate systemd units start the Vite frontend and Flask hardware service after `network-online.target`; each uses `Restart=on-failure` and a five-second delay. The XDG desktop launcher waits for `http://localhost:5173` before opening Chromium. Neither unit proves that its dependency is healthy merely by being active. See [frontend unit](../deploy/systemd/smart-vending-frontend.service), [Pi unit](../deploy/systemd/smart-vending-pi-unlock.service), [launcher](../edge/kiosk/launch-chromium-kiosk.sh), and [autostart guide](pi-autostart.md).
- **Source reviewed:** The frontend polls backend slots every seven seconds while safely idle. It polls a pending payment about every two seconds, and retries startup payment recovery after errors. A versioned `localStorage` record holds the active transaction and fulfillment state. `ATTEMPTING` after a reload shows staff assistance rather than replaying an unlock. A verified `SUCCESS` with `NOT_STARTED` can start one unlock attempt after saving `ATTEMPTING`. See [HomePage](../frontend/src/pages/HomePage.tsx), [recovery state](../frontend/src/active-payment-recovery.mjs), and [payment flow](../frontend/src/payment-flow.mjs).
- **Source reviewed:** The Pi service opens the configured Serial port once during startup at 115200 by default. A missing port causes startup failure and systemd can retry the process. After a successful start there is no automatic Serial reconnect on USB reset/disconnect; `/health` and `/hardware/status` can return 503. `/hardware/status` sends `GET_STATUS`, expects six reed/IR readings within three seconds, and does not issue `OPEN`. See [Pi service](../edge/pi_unlock_service.py) and [Serial client](../edge/serial_client.py).
- **Source reviewed:** The ESP32 sketch writes all active-low relay outputs HIGH before and after switching them to outputs, initializes sensors, starts Serial at 115200, then emits `READY`. Only an `OPEN:n` command drives one relay LOW; firmware aims to return it HIGH after 700 ms and rejects another `OPEN` while busy. `GET_STATUS` emits `DOOR` and `IR` readings for three slots. `LOCK` messages describe the commanded relay cycle, not physical lid or lock position. See [firmware](../firmware/vending_esp32.ino) and [Task 55 source of truth](task55-firmware-hardware-source-of-truth.md). The installed binary, wiring, relay behavior during the boot interval, and sensor polarity remain unverified on hardware.
- **Automated tests:** Results appear below. They exercise local logic or mocks, not physical behavior.

## Risks and decisions needed before physical acceptance

| Severity | Issue and source evidence | Consequence and proposed follow-up |
| --- | --- | --- |
| **High** | Pi `/unlock` accepts any positive `transactionId` and slot; it does not query backend payment authority. Its `unlock_transaction_outcomes` dictionary exists only in process memory. [Endpoint](../edge/pi_unlock_service.py) | A repeated request after Pi service restart can send another `OPEN`; a caller on the Pi can submit an unverified ID. Do not retry an uncertain physical unlock. Tech Lead should approve a durable, backend-authorized fulfillment record and a restart-safe idempotency/reconciliation protocol before changing this path. Localhost binding and CORS are deployment boundaries, not payment proof. |
| **High** | `open_slot()` returns after Serial write/flush. The service does not wait for `ACK:OPEN:n`, `ERROR:BUSY`, or a matched completion; firmware has no request ID. [Client](../edge/serial_client.py), [service](../edge/pi_unlock_service.py), [firmware](../firmware/vending_esp32.ino) | `UNLOCK_COMMAND_SENT` and the frontend success view can occur without a confirmed relay or lid movement. A Serial error can also leave an uncertain physical outcome. Treat such cases as staff reconciliation. Design ACK/error correlation and durable outcome recording before any automatic physical retry. |
| **Medium** | The frontend unit runs `npm run dev -- --host 0.0.0.0`; [Vite config](../frontend/vite.config.ts) does not set `strictPort`. The launcher requires 5173. | If 5173 is occupied, Vite can select 5174 while systemd stays active. Propose explicit `--port 5173 --strictPort`, with a failure and restart if 5173 cannot be bound. Check the installed unit and listener during 56-A. |
| **Medium** | The Pi Serial connection is opened at startup only; no reconnect loop appears in request paths. `/health` checks the port's `is_open` property, not an ESP32 `PONG`. [Pi service](../edge/pi_unlock_service.py), [client](../edge/serial_client.py) | A USB reset can leave the service unavailable until a controlled service restart, and a stale open handle may appear healthy until an I/O failure. Propose a bounded reconnect state machine and liveness check, with no queued or replayed `OPEN` commands. |
| **Medium** | Frontend API default is `http://localhost:3000`; on the Pi, localhost refers to the Pi. [API config](../frontend/src/config/api.ts), [example](../frontend/.env.example) | The installed Pi build/environment must point to the PC backend and the PC CORS allowlist must include the kiosk origin. Verify installed values without exposing secrets. Network recovery is blocked if these are wrong. |
| **Medium** | `localStorage` can be missing/corrupt; the kiosk can lose the active transaction ID during response loss or browser profile loss. Payment creation creates a DB row before the provider call. [HomePage](../frontend/src/pages/HomePage.tsx), [transaction service](../backend/src/services/transaction.service.ts) | A pending or successful charge may require manual lookup by transaction/charge ID. Never infer failure from a missing browser record or create a replacement payment until reconciled. |
| **Medium** | If provider charge creation succeeds but the backend loses its response, the catch path can mark the local transaction `FAILED` before a provider charge ID is saved. [Transaction service](../backend/src/services/transaction.service.ts) | A test charge could be orphaned from the local record. Reconcile provider and DB records manually. Propose a reviewed provider idempotency and orphan-charge recovery design before changing payment semantics. |
| **Medium** | Docker Compose declares a PostgreSQL volume but no service restart policy or backup procedure. Backend `/health` checks DB with `SELECT 1`. [Compose](../docker-compose.yml), [health](../backend/src/controllers/health.controller.ts) | After PC power loss, verify DB integrity and backups before accepting purchases. A healthy Express process alone is insufficient. |
| **Physical unknown** | Task 55 could not confirm flashed binary, GPIO wiring, external IR bias, relay contacts, or actual solenoid motion. | Hardware owner must verify startup and sensor observations. A source-level HIGH output is not proof of safe physical relay state throughout power sequencing. |

No payment, inventory, GPIO, pulse timing, firmware, or unlock retry code was changed. The code-level issues above are proposed changes for Tech Lead review.

## Prerequisites and stop conditions for owner-run physical tests

1. Obtain explicit project-owner approval for each physical session, especially 56-G. Assign one operator and one observer; keep the cabinet inaccessible to customers. Have an accessible power isolation point and a manual way to secure lids. Confirm no firmware flash, solenoid pulse, database write, or active payment is in progress before reboot or power interruption.
2. Record the actual Pi/PC addresses, installed unit files, kiosk configuration, `ESP32_SERIAL_PORT`, baud, `MOCK_HARDWARE` setting, backend API URL, CORS origin, deployed sketch identity, test-mode provider identity, and baseline time. Do not put secrets in evidence. Confirm `MOCK_HARDWARE` is **false** for physical sensor claims.
3. Back up PostgreSQL using the owner's established procedure and verify the backup can be read/restored in an isolated environment. Confirm free disk space, filesystem health, stable power, a graceful shutdown path, and safe access to Pi/PC consoles. Record baseline transaction IDs/statuses and slot states through approved read-only views. Do not edit live rows to manufacture a scenario.
4. Inspect the cabinet: lids latched, no person in the actuation area, no hot or stuck solenoid, relay power understood, sensors and slot labels mapped. Capture a read-only baseline `/hardware/status` and compare it with each physically observed lid and product. A `LOCK:CLOSED` line does not prove a lid is closed. Stop if any relay energizes without an authorized unlock command, a lid state disagrees, or a sensor reading is unstable.
5. For payment cases, use Opn **Test Mode** and preapproved test records. Record transaction ID and provider charge ID. Do not interrupt an active payment or unlock for 56-G. Do not repeat a physical unlock to resolve ambiguity; route it to staff reconciliation.

### Read-only evidence commands for the Pi/PC operator

Run on the appropriate host after approval. These commands inspect state; they do not restart a service or actuate hardware.

```bash
systemctl is-enabled smart-vending-frontend.service smart-vending-pi-unlock.service
systemctl is-active smart-vending-frontend.service smart-vending-pi-unlock.service
systemctl show -p MainPID -p NRestarts -p ExecMainStatus smart-vending-frontend.service smart-vending-pi-unlock.service
journalctl -b -u smart-vending-frontend.service -u smart-vending-pi-unlock.service --no-pager
ss -ltnp | grep -E ':5173|:5174|:5000'
curl --fail --silent --show-error http://localhost:5173/
curl --fail --silent --show-error http://localhost:5000/health
curl --fail --silent --show-error http://localhost:5000/hardware/status
```

Check the PC backend using its actual PC address: `curl --fail http://<PC_BACKEND_HOST>:3000/health` (the response must say `database: connected`). Read Docker/PostgreSQL logs and a read-only transaction/slot view through the owner's established tooling. Do not expose customer data, keys, or full environment files in captured evidence.

## Owner-run acceptance checklist

For every case capture: date/time, operator, hardware/software versions, starting transaction and slot state, actions, terminal/service logs with secrets removed, sensor readings, physical observation, ending transaction and slot state, and a PASS/FAIL/BLOCKED decision. A source claim or unit test is not a physical PASS.

### 56-A — Raspberry Pi graceful reboot

1. With no active payment or pulse, record both unit states, exact installed `ExecStart` values, listener ports, Chromium URL, backend health, all three physical lids, and `/hardware/status`.
2. Owner performs one graceful Pi reboot. Observe the relay/solenoid area continuously; record any unintended movement or sound.
3. After login, confirm both units are enabled and active, Vite listens **only** on 5173 for this app (no fallback 5174), the Pi service answers `/health` with `hardware: connected`, and Chromium opens the product page at `localhost:5173` without manual launch. Confirm backend `/health` reports DB connected and slot data refreshes.
4. Compare each physical lid/product to `/hardware/status`; compare transaction and slot states to baseline. No `OPEN` request or relay pulse should appear in logs during boot.

**Expected:** startup and communication recover, with no unsolicited unlock or inventory change. If either service is active but the endpoint/port is wrong, FAIL. If installed configuration or hardware observation is unavailable, BLOCKED.

### 56-B — ESP32 reset / USB Serial reconnect

1. At idle, record Pi `/health`, `/hardware/status`, Serial device path, and visually observed relay state. Ensure no payment or pulse is active.
2. Owner performs a controlled ESP32 reset or USB disconnect/reconnect, one at a time. Observe all relays and lids. Capture ESP32 `READY` through a **passive approved monitor** if available; avoid opening a second Serial client that displaces the Pi service.
3. Poll read-only Pi `/health` and `/hardware/status`. Record whether the service itself recovers. If it remains disconnected, use the approved maintenance procedure to restart the Pi service **only after** confirming no pending unlock; then recheck status. Do not send `OPEN` as a connectivity probe.

**Expected:** relay stays off on boot, no automatic unlock, `READY` is emitted, and sensor reads recover. Current source does **not** promise live Serial reconnect. Mark the reconnect portion FAIL if the acceptance requirement is automatic recovery; record a separate manual-restart recovery result. Missing passive startup evidence is BLOCKED for the `READY` observation.

### 56-C — physical hardware state

1. With relay power safe and no payment, physically inspect each slot's lid and product state. Query `/hardware/status` after boot and once more after readings stabilize.
2. Compare `DOOR:n:CLOSED/OPEN` to actual lid position and `IR:n:PRESENT/EMPTY` to actual product presence for slots 1–3. Where the owner safely changes a lid or product state, observe the corresponding read-only change and restore the baseline.
3. Record relay indicator/voltage using approved equipment and method. Keep relay control status, solenoid/lock motion, and reed lid state as separate observations. Never call `/unlock` solely to verify startup safety.

**Expected:** all three sensor readings match observation, are stable, and no relay is energized at idle. Any mismatch or uncommanded energizing is FAIL; missing physical access or measurement is BLOCKED.

### 56-D — backend / database restart

1. Capture baseline read-only payment IDs/statuses and slots. Use only an idle period or a controlled Opn test case with known ID. Owner restarts backend and PostgreSQL using the approved PC procedure, avoiding an in-flight DB write.
2. During outage, observe kiosk error/retry behavior. A new payment must not be confirmed locally; no unlock should occur from a newly unverified charge. Read-only Pi hardware status may remain available because it is local.
3. After recovery, require backend `/health` with `database: connected`; verify slot refresh and any known payment status against provider/backend authority. Compare transaction count, status, `SOLD_OUT` state, and Pi unlock logs before/after.

**Expected:** no duplicate transaction caused by recovery alone and no accidental inventory mutation or unlock. If payment status is uncertain, BLOCKED pending reconciliation, with no physical retry. A DB corruption, duplicated sale, or unsolicited unlock is FAIL.

### 56-E — Pi-to-PC network disconnect / reconnect

1. Capture an idle baseline, then have the owner isolate only Pi-to-PC connectivity through an approved network method. Confirm the local frontend and Pi service stay accessible, and backend requests fail.
2. Verify idle slot refresh shows an error on first load or retains previously loaded slot data; attempting to create a **test-mode** payment during outage should show a safe creation error. A previously displayed QR may remain visible while status polling reports retry. Do not treat a stale slot view as inventory authority.
3. Restore network. Verify backend `/health`, slot refresh, pending-payment status polling/recovery, and no extra `OPEN` or database change. Record whether the installed API URL and CORS allowlist match the actual Pi/PC addresses.

**Expected:** no new offline payment success or unlock based solely on stale UI. A payment verified `SUCCESS` before the disconnection may continue to a Pi-local unlock; record this separately rather than calling all offline actions impossible. Uncertain payments require backend/provider reconciliation.

### 56-F — payment and session recovery

1. In Opn Test Mode, run separately approved cases for `PENDING`, verified `SUCCESS` before unlock, `ATTEMPTING`/interrupted unlock, and terminal `FAILED`/`EXPIRED` or customer-cancelled payment. Capture the browser's active-payment state only through approved non-secret diagnostics, backend transaction/slot records, and Pi logs.
2. For `PENDING`, refresh/relaunch the kiosk and verify it restores waiting and polls backend; there must be no unlock. If the backend is unavailable, it should show recovery/error and retry. For `FAILED`/`EXPIRED`/cancelled, verify no unlock and no sale completion for a cancelled purchase.
3. For `SUCCESS` plus persisted `NOT_STARTED`, observe one authorized unlock attempt only after backend status confirmation and persistence of `ATTEMPTING`. Do this only as a separately approved physical dispense test. For persisted `ATTEMPTING`, reboot/relaunch and expect staff assistance, **not** an automatic replay. For persisted `UNLOCKED`, expect success display; this state means Serial write was reported, not physical proof.
4. Compare a duplicate request within one Pi process with the same request after a Pi service restart only through a reviewed, **non-actuating** test harness or logs. Do not issue a second live `/unlock` to probe deduplication. Record whether the Pi process restarted during the transaction.
5. Review staff sessions using backend current-session state after reconnect. A staff session must not displace an active customer payment. Resume/cancel via the existing authorized workflow; do not change inventory to force recovery.

**Expected:** backend transaction and slot state remain authoritative. Any ambiguity between provider success, browser state, Serial write, ACK, and physical lid/product state is BLOCKED for automatic fulfillment and requires staff reconciliation. Exactly-once physical unlock is **not** an accepted claim under current design.

### 56-G — controlled power loss

1. Obtain **explicit project-owner approval for the actual power interruption** and record the intended power boundary (Pi only, ESP32/relay supply, or PC). Test graceful shutdown/reboot first and resolve any 56-A to 56-F safety failure before abrupt testing.
2. Verify backup, filesystem/DB checks, stable restoration path, observer, safe relay state, no customer access, **no active payment, firmware flash, database write, or solenoid pulse**, and a read-only baseline of all slots and transactions. Stop if any condition is uncertain.
3. The owner manually cuts only the approved power boundary for the approved duration, then restores power. Observe the relay/solenoid continuously. No assistant or automated script performs this action.
4. Inspect boot logs, filesystem and PostgreSQL recovery logs, service health, exact frontend port, Chromium, Serial health, all three sensors and physical lids/products, backend transactions/slots, and provider reconciliation for any preexisting test charge.

**Expected:** safe relay state, no unsolicited unlock, recoverable filesystems/database, services and UI return, no duplicate sale or inventory drift. Any corruption, energizing, or unexplained state change is FAIL. Without explicit approval, safe prerequisites, or physical observation, 56-G remains BLOCKED/NOT TESTED.

## Result rules, reconciliation, and rollback

- **PASS:** every listed observation for that case was actually performed and captured, expected service/payment/inventory state matches authority, and no uncommanded actuator activity occurred. A unit test alone cannot satisfy a physical case.
- **FAIL:** an observed unsafe relay/solenoid event, duplicate physical unlock, unexpected transaction/slot mutation, mismatched physical sensor, wrong port, or required recovery that does not occur. Stop further physical tests and isolate the cabinet.
- **BLOCKED:** missing approval, prerequisites, safe test fixture, access, evidence, dependency, or unresolved payment/physical outcome. Record why. Do not convert BLOCKED into PASS by inference.
- For an uncertain payment/unlock, preserve transaction ID, charge ID, timestamps, Pi/ESP32 logs, and physical lid/product observations. Reconcile the provider charge against the backend transaction and slot. Keep the slot unavailable and involve staff for customer fulfillment/refund under the owner's policy; do not repeat `/unlock` automatically or edit DB rows ad hoc.
- If startup fails, leave actuation power isolated as needed, inspect `journalctl` and the installed unit/config, restore the last reviewed unit/config through the owner's maintenance process, and start services only after verifying no pending unlock. If PostgreSQL is unhealthy, stop purchases and restore from a verified backup using the owner's DB procedure; do not reset the Docker volume. Reopen the kiosk only after `/health` says DB connected and physical status agrees with observation.

## Safe automated validation on this branch

Executed on the local Windows workspace, without physical serial, real payment, live service restart, or inventory mutation:

| Command | Result | Limit |
| --- | --- | --- |
| `npm.cmd test` in `frontend` | **PASS:** 100/100 tests | Node tests and source checks; no Chromium reboot or actuator. |
| `python edge/serial_test.py --self-test` with `PYTHONDONTWRITEBYTECODE=1` | **PASS:** 10/10 parser cases | Parser only; no Serial port opened. |
| `python -m unittest edge.tests.test_pi_unlock_service` with `PYTHONDONTWRITEBYTECODE=1` | **BLOCKED:** import fails, `ModuleNotFoundError: flask`; no test assertion ran | This Windows Python environment lacks Flask. |
| `npm.cmd test` in `backend`, ordinary invocation | **BLOCKED:** `tsx` fails before tests with Node `uv_os_get_passwd` / `ENOMEM` | Windows test-runner environment failure; no assertion ran in this invocation. |
| `npm.cmd test` in `backend`, temporary test-only `NODE_OPTIONS` preload replacing `os.userInfo()` | **PASS:** 98/98 tests | The shim worked around the Windows runner failure for child processes. It was removed immediately afterward. These are mocked/local unit tests; normal environment compatibility and a live DB restart are unverified. |

No physical case was performed in that earlier local validation. Re-run the Pi suite with its dependencies and confirm the backend suite with an ordinary runner in a suitable isolated environment before Tech Lead acceptance. Existing relevant tests cover frontend payment recovery, Pi in-memory deduplication with mocks, backend payment reconciliation, kiosk sessions, and webhook validation; these tests do not establish live DB or hardware behavior.

## 56-F.3 — interrupted unlock and restart-safe deduplication (2026-10-12)

This is **non-actuating acceptance** using Flask's local test client, a fake Serial transport, fake external payment records, and frontend/backend unit tests. No Pi endpoint, physical port, provider, database, or actuator was contacted. The owner reports Phase 1 USB reconnect physical acceptance as passed; that is separate from these results.

| Scenario | Result | Observed fake `OPEN` count and meaning |
| --- | --- | --- |
| Same successful transaction and slot requested twice within one Pi process | **PASS** for process-local deduplication | `OPEN:2` **1**; second response says `ALREADY_UNLOCKED`, `deduplicated: true`. |
| Same transaction and slot after simulated Pi process restart | **FAIL** for restart-safe deduplication | `OPEN:2` **2** total; clearing only the process outcome map while retaining the fake external payment record causes a second dispatch. |
| A: interruption before Serial write | **PASS** for no same-process replay; **FAIL** for durable outcome knowledge | **0** before write and on same-process duplicate (`UNLOCK_OUTCOME_UNCERTAIN`); **1** after an explicit request following simulated process restart. If interruption occurs before frontend `ATTEMPTING` is persisted, `NOT_STARTED` permits one recovery attempt. |
| B: Serial write occurred, HTTP response lost | **PASS** for persisted frontend `ATTEMPTING` assistance; **FAIL** for restart-safe Pi deduplication | **1** before restart; **2** after a separate explicit duplicate request following restart. The frontend recovery path itself sends **0** additional unlocks. |
| C: frontend persisted `ATTEMPTING` before interruption | **PASS** for frontend no automatic resend | **0** recovery unlock callbacks; assistance shown once. If no Serial write occurred, fulfillment remains uncertain and requires staff. |
| D: frontend persisted `UNLOCKED` before interruption | **PASS** for frontend no automatic resend | **0** recovery unlock callbacks; success view shown once. `UNLOCKED` reflects reported Serial write, not ESP32 ACK or physical dispense. |
| Payment authority boundary: `PENDING`, `FAILED`, `EXPIRED`, cancelled, `SUCCESS`, first request with wrong paid slot, and nonexistent ID | **FAIL** at Pi `/unlock` boundary | Seven distinct syntactically valid IDs each dispatched `OPEN:2` once (**7** total), even with fake external records showing six unauthorized/mismatched cases. The route never consults those records. A later alternate-slot request for an already seen ID returns 409 and adds **0** commands. Frontend recovery selects no unlock for the four non-fulfillable payment states; backend tests retain payment/inventory authority. |
| Real restart, ACK, relay, lid, product, and inventory reconciliation | **BLOCKED** for this non-actuating run | No physical commands or live database checks; fake Serial dispatch is not proof of actuation or dispense. |

The Pi route validates the ID and slot format and remembers outcomes only in its process dictionary. It does **not** verify transaction existence, payment `SUCCESS`, cancellation, or transaction-to-slot binding against the backend. The frontend normally gates fulfillment on backend status and persisted state, but a direct caller that can reach `/unlock` can bypass that gate. Backend unit tests confirm provider success and `SOLD_OUT` accounting remain authoritative and idempotent; the fake Pi requests did not touch inventory. No integrated Pi/backend transaction or live database assertion was made.

Regression evidence on this workspace: Pi service, Serial recovery, and new F.3 tests **75/75 PASS** (`python -m unittest edge.tests.test_task56_f3_acceptance edge.tests.test_pi_unlock_service edge.tests.test_serial_recovery` in the local venv); frontend **104/104 PASS** (`npm.cmd test`); Serial parser **10/10 PASS** (`edge/serial_test.py --self-test`); backend **98/98 PASS** with a temporary test-only `os.userInfo()` preload removed after the run. Ordinary backend `npm.cmd test` remains **BLOCKED** on this Windows runner by Node `uv_os_get_passwd` / `ENOMEM` before assertions. New focused tests: `edge/tests/test_task56_f3_acceptance.py` and `frontend/tests/task56-f3-acceptance.test.mjs`.

**Prototype operating precaution:** restrict Pi `/unlock` network access to the kiosk/trusted operator path; keep the cabinet supervised. Record the transaction ID, paid slot, backend/provider status, Pi process restart, and physical lid/product state for any uncertain result. Treat `ATTEMPTING`, lost responses, or a Pi restart during fulfillment as staff-assistance cases; reconcile against backend authority and the physical machine before any manual action. Do not automatically repeat `/unlock`. A controlled live hardware regression remains necessary for end-to-end acceptance, under the owner-run checklist above. Restart-safe claims or direct-call authorization require a reviewed production design change before acceptance.
