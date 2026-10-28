# Task 62.1 — Final E2E Audit and Acceptance Test Plan

**Project:** Smart Vending Machine, single-cabinet university prototype  
**Document status:** RECONCILIATION BLOCKED — operator physical results recorded;
Production database evidence unavailable; awaiting Tech Lead review  
**Audit date:** 2026-10-28 (Asia/Bangkok)  
**Repository revision inspected:** `e272abb9e27060bd2bcf5f1b8fa587bb11ec28b9` (`main`)  
**Execution boundary:** audit, read-only evidence inspection, and documentation only

No Production database query could be completed because this workstation exposes
only a localhost `DATABASE_URL` and no usable read-only Railway database session.
No purchase, employee creation, payment, webhook, LINE delivery, Pi/ESP32 action,
service restart, Railway/Cloudflare edit, commit, push, merge, or deployment was
performed during this reconciliation. Commands below remain an operator runbook
for a later, separately approved read-only database session.

## 1. Decision boundary and audit findings

Task 61 is reported closed with this Production state:

| Object | Reported count/state |
| --- | ---: |
| `Transaction` | 0 |
| `RestockLog` | 0 |
| `KioskSession` | 0 |
| `Employee` | 0 |
| `Product` | 12 |
| `Slot` | 3 |
| `SalesReportDelivery` | 3 |
| `HardwareMachine` | 1 |
| `HardwareAlertEvent` | 6 |
| `_prisma_migrations` | 15 |
| `EmployeeCodeNumber_seq` | ready to allocate `EMP001` |

Those values are operator-provided prerequisites, not observations made in this
audit. The repository's untracked `backend/ops/task61/README.md` still says the
reset was only prepared and rehearsed. The Task 61 execution transcript, script
hash, backup identifier, and final read-only Production export must therefore be
attached before Task 62 execution.

The implementation supports a safe supervised demonstration, with one material
acceptance boundary:

- Provider reconciliation and database sale completion are idempotent.
- The browser suppresses repeated fulfillment in the normal flow and persists a
  small recovery state in `localStorage`.
- Pi `/unlock` deduplication is process-local. It does not survive a Pi hardware
  service restart, does not independently verify backend payment authority, and
  returns success after a Serial write without waiting for an ESP32 ACK or proof
  of physical dispensing.
- Consequently, an uninterrupted successful vend can be accepted as one observed
  unlock, but durable **exactly-once physical fulfillment across restart cannot be
  accepted**. Task 56 case 56-F.3 remains a known FAIL. Any uncertain outcome goes
  to staff assistance and must never be retried automatically.

Other audit observations and confirmed responsibility boundaries:

1. There is no Railway or Cloudflare manifest in Git. Live service commands,
   schedules, environment-variable presence, Access policies, tunnel ingress,
   and Opn webhook settings require redacted dashboard evidence.
2. `docs/phase2-owner-sales-reports.md` and
   `docs/phase3-hardware-monitoring.md` still use pre-deployment wording although
   the supplied reset inventory contains report and hardware-alert records.
3. LINE responsibilities are intentionally separate: the Operational LINE OA
   (`LINE_CHANNEL_ACCESS_TOKEN`) receives sale/restock notifications; the Owner
   LINE OA (`LINE_OWNER_CHANNEL_ACCESS_TOKEN`) receives scheduled Daily/Weekly
   Sales Reports; and the VendingMaintenance LINE OA
   (`LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN`) receives Pi OFFLINE/RECOVERED alerts.
   The Owner LINE OA does **not** receive per-sale notifications.
4. The working tree was already dirty before this document: modified
   `deploy/systemd/pi-unlock-service.env.example` and untracked
   `backend/ops/task61/`. The added `KIOSK_MACHINE_ID` in the unlock-service
   example is not consumed by `edge/pi_unlock_service.py`; the heartbeat reads it
   from the cloud-relay environment. No existing change was altered here.

## 2. Status and evidence rules

- **PASS** means new evidence from the final post-reset run satisfies every
  expected result.
- **FAIL** means observed behavior violates the expected result or a known current
  implementation cannot meet it.
- **NOT TESTED** means no new post-reset evidence exists. Historical PASS is
  supporting context only and never upgrades this result.
- **BLOCKED** means an acceptance observation or required evidence source was not
  available. It is not a behavioral FAIL and cannot be treated as PASS.
- **OPERATOR-REPORTED PASS** records a new physical/UI observation supplied by the
  operator. It is not database verification and does not satisfy a separate DB
  evidence requirement.
- **PENDING** is recorded as **NOT TESTED (PENDING)**. In particular, Weekly
  automatic reporting remains PENDING until its first real scheduled run.
- Screenshots must include a trustworthy clock where timing matters. Logs must
  include timestamps and revision/service identity, but no secrets, JWTs, face
  embeddings, full webhook bodies, or QR payment secrets.
- One approved Opn Test Mode successful transaction should be reused across
  payment, webhook, unlock, recovery, and LINE checks to minimize side effects.

### Task 62.2E reconciliation evidence, 2026-10-28

**Overall result: BLOCKED.** The operator-reported physical demonstration scope is
PASS, but final Production database reconciliation was not possible from this
workstation. The local `backend/.env` resolves `DATABASE_URL` to localhost,
Railway CLI is not installed, and no usable read-only Railway database session was
available. No substitute local-database result has been presented as Production
evidence.

Evidence classes recorded in this update:

| Evidence class | Result |
| --- | --- |
| Operator report | Kiosk boot/product display; EMP001 registration and face authentication; Opn Test Mode purchases for slots 1–3; correct-slot solenoid unlock and Thai audio; Operational LINE sale/inventory notifications; face-authenticated restock for slots 1–3; products returned to available; VendingMaintenance OFFLINE at approximately four minutes and RECOVERED at approximately one minute. |
| Read-only LINE client observation | Existing chat-list previews showed VendingMaintenance recovery activity, a SmartVendingMachine restock notification naming EMP001, and a SmartVendingOwner Daily report preview. No message was sent and no retry control was used. Chat-list previews do not prove DB linkage, exact counts, delivery uniqueness, or the OFFLINE ledger row. |
| Production database | **BLOCKED / NOT VERIFIED.** No Production query was executed. Transaction, employee, restock, heartbeat/alert, report-delivery, migration, Product, and Slot assertions below remain unverified. |

No operator-reported contradiction was identified. The unresolved evidence gap
means duplicate transactions, unresolved payments, unexpected rows/errors,
orphaned linkage, final inventory consistency, and migration/configuration
preservation cannot yet be excluded.

The independent D01 pre-test baseline was not captured during this audit before
the operator executed acceptance mutations. A current Production query cannot
reconstruct the zero-transaction/zero-employee reset state. Closure therefore
requires the immutable Task 61 final export/transcript as D01 evidence, followed
by a fresh D02 read-only snapshot and a delta reconciliation to the three sales,
EMP001, the restock workflow, and the monitoring drill.

The current schema has no durable physical-fulfillment or solenoid-dispatch
record. A future read-only query can prove successful paid transactions and
inventory transitions, while the physical correct-slot unlock remains operator
evidence. This is consistent with T62-U03 remaining FAIL under its approved waiver.

## 3. Final acceptance matrix

| ID | Acceptance area | Current result | Evidence / disposition | Essential for final demo |
| --- | --- | --- | --- | --- |
| T62-A01 | Local backend/frontend automated regression | **PASS** | N/A | Yes, release gate |
| T62-A02 | Pi edge/face Python automated regression | **NOT TESTED** | Historical suite evidence only | Yes, release gate |
| T62-D01 | Post-reset counts, sequence, Product/Slot baseline | **BLOCKED** | Task 61 reported CLOSED; no independent Production query | Yes |
| T62-B01 | Pi cold boot and automatic Chromium kiosk | **OPERATOR-REPORTED PASS** | Kiosk booted automatically and displayed products normally | Yes |
| T62-C01 | Cloud relay, API, product/slot display, portal boundaries | **BLOCKED — partial operator PASS** | Product display observed; DB/API and access-boundary evidence unavailable | Yes |
| T62-E01 | First new employee is `EMP001` | **BLOCKED — operator UI PASS** | EMP001 registration reported; DB row/sequence not verified | Yes |
| T62-F01 | Face enrollment and randomized head-turn challenge | **OPERATOR-REPORTED PASS** | EMP001 face registration passed; no DB metadata query | Yes |
| T62-F02 | Staff face authentication and fail-closed recovery | **BLOCKED — partial operator PASS** | Successful EMP001 authentication reported; negative/fail-closed drill not evidenced | Yes |
| T62-R01 | Restock, per-slot unlock, IR/Reed state, commit | **BLOCKED — operator physical PASS** | All three slots restocked and products became available; RestockLog/employee linkage not verified | Yes |
| T62-P01 | Opn Test Mode QR and webhook reconciliation | **BLOCKED — operator physical PASS** | Purchases passed for slots 1–3; charge/webhook/DB rows not independently reconciled | Yes |
| T62-P02 | Provider/database idempotency | **BLOCKED** | Backend automated tests PASS; Production duplicates/unresolved rows not queried | Yes |
| T62-U01 | Correct slot, one observed unlock, success UI | **OPERATOR-REPORTED PASS** | Correct solenoid and Thai audio passed for all three slots; no durable fulfillment ledger exists | Yes |
| T62-U02 | Same-process duplicate unlock suppression | **NOT TESTED** | Task 56 fake-Serial PASS | No; acceptance safety check |
| T62-U03 | Restart-safe durable exactly-once unlock | **FAIL** | Disposition: **ACCEPTED PROTOTYPE WAIVER**; post-restart explicit retry reproducibly redispatches in fake Serial | Yes as a disclosed/waived limitation |
| T62-X01 | Refresh guard and pending-payment reboot recovery | **NOT TESTED** | Task 56-F.1 PASS in tested scope | Yes |
| T62-X02 | Failed/expired/cancelled recovery without unlock | **NOT TESTED** | Task 56-F.2 and automated tests PASS | No; run if time permits |
| T62-L01 | Operational sale/restock LINE notification | **BLOCKED — operator PASS / partial read-only preview** | Automatic sale/inventory delivery reported; restock preview observed; DB claims/uniqueness not verified | Yes if in presentation scope |
| T62-S01 | Daily automatic owner report | **NOT TESTED** | Implementation tests; 3 preserved delivery rows are not post-reset proof | No; scheduled evidence gate |
| T62-S02 | Weekly automatic owner report | **NOT TESTED (PENDING)** | Implementation tests only | No; deferred scheduled observation |
| T62-H01 | Normal heartbeat remains ONLINE without alert | **NOT TESTED** | Implementation tests only | No |
| T62-H02 | OFFLINE then RECOVERED through Maintenance OA | **BLOCKED — operator physical PASS** | OFFLINE ≈4 min and RECOVERED ≈1 min reported; recovery preview observed; alert ledger not queried | No; final acceptance check |
| T62-Q01 | User-facing cloud/hardware/face/payment recovery paths | **NOT TESTED** | Automated UI/service tests PASS | No; supervised error drill |
| T62-D02 | Final configuration and expected-delta reconciliation | **BLOCKED** | Production read-only database session unavailable | Yes, closeout gate |
| T62-M01 | Timed presentation rehearsal | **NOT TESTED** | N/A | Yes |

## 4. Detailed acceptance cases

### T62-A01 — Local backend/frontend automated regression

| Field | Requirement |
| --- | --- |
| Preconditions | Repository at the reviewed revision; installed Node dependencies. No Production credentials are needed. |
| Exact steps / commands | From `backend/`: `$env:NODE_OPTIONS='--require=C:\smart-vending\.tmp\tsx-userinfo-workaround.cjs'; npm.cmd test`. From `frontend/`: `npm.cmd test`. The preload is the repository's existing audit-host workaround for Node 24 `uv_os_get_passwd ENOMEM`; it does not change application behavior. |
| Expected result | All backend and frontend tests pass with no external calls. |
| Current result | **PASS** — 193/193 backend and 138/138 frontend on 2026-10-28. |
| Required evidence | Complete console logs, revision hash, and Node version. |
| Essential | **Yes**; release gate, not a live demo step. |

### T62-A02 — Pi edge/face Python automated regression

| Field | Requirement |
| --- | --- |
| Preconditions | Installed Pi virtual environment from `edge/requirements.txt`, camera/Serial replaced by the test doubles used by the suites, and no Production credentials. |
| Exact steps / commands | From the repository root on the Pi: `source .venv/bin/activate`; `python -m unittest discover -s edge/tests -v`; `python -m unittest discover -s edge/face/tests -v`. These suites must not operate physical Serial or send LINE/payment traffic. |
| Expected result | All edge relay/unlock/recovery and face engine/storage/liveness tests pass. |
| Current result | **NOT TESTED** in this audit. The Windows host lacked readable Flask/NumPy dependencies; partial imports are not credited. |
| Required evidence | Complete Pi console logs, revision hash, Python/OpenCV versions, and explicit confirmation that test doubles were used. |
| Essential | **Yes**; execution-day release gate. |

### T62-D01 — Verify Task 61 result and capture immutable baseline

| Field | Requirement |
| --- | --- |
| Preconditions | Tech Lead-approved read-only Railway database session; Task 61 transcript and backup identifier available. Do not use a URL/password on the command line. |
| Exact steps / commands | In the secure `psql` session, run: `BEGIN READ ONLY;` then `SELECT 'Transaction' AS object, count(*) FROM "Transaction" UNION ALL SELECT 'RestockLog',count(*) FROM "RestockLog" UNION ALL SELECT 'KioskSession',count(*) FROM "KioskSession" UNION ALL SELECT 'Employee',count(*) FROM "Employee" UNION ALL SELECT 'Product',count(*) FROM "Product" UNION ALL SELECT 'Slot',count(*) FROM "Slot" UNION ALL SELECT 'SalesReportDelivery',count(*) FROM "SalesReportDelivery" UNION ALL SELECT 'HardwareMachine',count(*) FROM "HardwareMachine" UNION ALL SELECT 'HardwareAlertEvent',count(*) FROM "HardwareAlertEvent" UNION ALL SELECT '_prisma_migrations',count(*) FROM _prisma_migrations;` then `SELECT last_value,is_called FROM "EmployeeCodeNumber_seq";` then `SELECT s.id,s."slotNumber",s.status,s."productId",p.name,p.price,p."imageUrl",p."isActive" FROM "Slot" s LEFT JOIN "Product" p ON p.id=s."productId" ORDER BY s."slotNumber";` then `SELECT id,name,price,"imageUrl","isActive" FROM "Product" ORDER BY id;` and `COMMIT;`. |
| Expected result | Counts exactly match the reported reset state; sequence is `last_value=1,is_called=false`; three slots have the approved Product assignments and values; no orphaned `productId`. |
| Current result | **BLOCKED** — Task 61 baseline counts were supplied by the operator but were not independently captured before the acceptance mutations. A current query cannot reconstruct this baseline; the immutable Task 61 final export/transcript is required. |
| Required evidence | Redacted query transcript, Task 61 script SHA-256, execution timestamp, backup ID, commit confirmation, slot/product CSV or screenshot. |
| Essential | **Yes.** Stop if any count, assignment, or sequence state differs. |

### T62-B01 — Cold boot and automatic kiosk startup

| Field | Requirement |
| --- | --- |
| Preconditions | Cabinet idle; no pending payment or staff session; safe physical observation of all solenoids; approval to power-cycle/reboot. |
| Exact steps / commands | Record baseline counts. Shut down/power on using the approved cabinet procedure. Do not manually launch Chromium. After login/SSH, run `systemctl is-enabled smart-vending-frontend.service smart-vending-pi-unlock.service smart-vending-pi-cloud-relay.service`; `systemctl is-active smart-vending-frontend.service smart-vending-pi-unlock.service smart-vending-pi-cloud-relay.service`; `curl --fail http://127.0.0.1:5173/`; `curl --fail http://127.0.0.1:5000/health`; `curl --fail http://127.0.0.1:3000/health`; `journalctl -u smart-vending-frontend.service -u smart-vending-pi-unlock.service -u smart-vending-pi-cloud-relay.service -b --no-pager`. Observe the screen and locks throughout boot. |
| Expected result | All three services are enabled/active; local frontend, hardware health, and relay health return 200; Chromium launches automatically only after stable readiness and renders the customer page; ESP32 reconnects; no unintended relay/solenoid actuation or data mutation occurs. |
| Current result | **OPERATOR-REPORTED PASS** post-reset: kiosk booted and displayed products normally. Service-state commands, current-boot logs, and database before/after evidence were not supplied to this audit. |
| Required evidence | Continuous boot video, command transcript, current-boot journal, kiosk screenshot, before/after transaction and slot snapshot. |
| Essential | **Yes.** |

### T62-C01 — Cloud connectivity, product/slot display, and access boundaries

| Field | Requirement |
| --- | --- |
| Preconditions | B01 passed; Cloudflare/Railway/Opn dashboards are read-only for this check; approved operator can use human Access. |
| Exact steps / commands | On Pi: `curl --fail http://127.0.0.1:3000/api/v1/slots`; `curl --fail http://127.0.0.1:5000/health`; `curl -i http://127.0.0.1:3000/admin`; `curl -i http://127.0.0.1:3000/api/v1/admin/slots`. On screen, compare all three displayed slot numbers, names, prices, images/fallbacks, availability, and enabled state with D01. In a human browser, open and directly refresh `https://vending.smartvendingpt.com/staff` and `/admin`. Capture redacted Railway health and Cloudflare Access/tunnel status. |
| Expected result | Relay slots request returns the three configured slots from Railway; kiosk matches the database; local hardware stays on port 5000; relay rejects Admin paths; human Access protects and serves Staff/Admin; no Cloudflare secret appears in browser traffic. |
| Current result | **BLOCKED — partial operator PASS.** The kiosk displayed products normally, but the cloud slot response, Production DB comparison, portal boundaries, and Railway/Cloudflare evidence were not independently inspected. |
| Required evidence | Redacted JSON, kiosk/portal screenshots, network panel showing loopback relay/same-origin portal calls, Cloudflare/Railway status screenshots. |
| Essential | **Yes.** |

### T62-E01 — Create the first employee as EMP001

| Field | Requirement |
| --- | --- |
| Preconditions | D01 sequence check passed; `/admin` accessible; no active kiosk session; agreed employee display name; privacy consent. |
| Exact steps / commands | Open `/admin` → Employee management → Add Employee. Enter only the approved name; do not supply a code or biometric field. Submit once. In the secure read-only DB session run `BEGIN READ ONLY; SELECT id,name,"employeeCode","faceRegistered","isActive","offboardedAt" FROM "Employee" ORDER BY id; SELECT last_value,is_called FROM "EmployeeCodeNumber_seq"; COMMIT;`. |
| Expected result | UI and DB show exactly one active employee with code `EMP001`, `faceRegistered=false`, and no offboard time; sequence is called at value 1; no duplicate row/session is created by refresh. |
| Current result | **BLOCKED — operator UI PASS.** The operator reports that the first post-reset employee registered as `EMP001`; the Production employee row and sequence were not queried. |
| Required evidence | Admin success screenshot, redacted DB result, timestamp, employee consent record. Do not capture face images. |
| Essential | **Yes.** A different first code is a stop condition. |

### T62-F01 — Face enrollment and head-turn challenge

| Field | Requirement |
| --- | --- |
| Preconditions | E01 passed; Pi camera/models healthy; EMP001 has no local template; cabinet lighting and distance recorded; no other face visible. |
| Exact steps / commands | In `/admin`, start Face Registration for EMP001. Confirm the Pi changes from customer mode to registration without a public camera stream. Follow the displayed physical turn and return-to-center instruction, then finish all enrollment samples. Run only metadata checks: `curl --fail http://127.0.0.1:5000/camera/status` and, through the UI/API flow, confirm registration status; inventory the template directory by filename only, never print file contents. Across this enrollment and later successful authentication attempts, repeat until both displayed physical directions have been observed and passed: server `TURN_LEFT` is presented as physical right; server `TURN_RIGHT` as physical left. |
| Expected result | One camera owner, live preview only on Pi, randomized turn then center succeeds, one EMP001 template exists locally, backend marks `faceRegistered=true`, session completes, no frame/embedding reaches Railway. Both deployed direction labels are physically correct. |
| Current result | **OPERATOR-REPORTED PASS** for EMP001 face registration and the deployed face flow. Production `faceRegistered` metadata and filename-only Pi template inventory were not independently inspected. |
| Required evidence | Video/screenshots without retained face imagery where possible, session ID/timestamps, safe service logs, filename-only template inventory, DB metadata. |
| Essential | **Yes.** |

### T62-F02 — Staff authentication and fail-closed recovery

| Field | Requirement |
| --- | --- |
| Preconditions | F01 passed; EMP001 active; no payment/staff session. |
| Exact steps / commands | Open `/staff`, start Restock, and watch the Pi poll into Face Scan. First present one motionless printed or phone-displayed face for one attempt; confirm `LIVENESS_FAILED`/no authorization. Then retry with EMP001 and complete the shown turn/center action. Do not accumulate three failures unless the 180-second lockout is intentionally scheduled. Cancel once and verify camera release, then start again and authenticate successfully. |
| Expected result | Static presentation fails closed and creates no authorization; cancel releases camera; valid EMP001 is verified by the backend and shown in Restock Mode; unknown/inactive/network-error results never enter Restock; no public preview URL works. |
| Current result | **BLOCKED — partial operator PASS.** Valid EMP001 face authentication passed. Static-media failure, cancel/retry, inactive/unknown identity, and public-preview-negative checks were not reported. |
| Required evidence | Pi UI recording, safe logs with result codes/attempt count, staff portal session state, absence of template/frame leakage. |
| Essential | **Yes** for valid auth and cancel/retry; adversarial static-media check may be performed immediately before, not during, the timed demo. |

### T62-R01 — Restock workflow and IR/Reed states

| Field | Requirement |
| --- | --- |
| Preconditions | F02 authenticated; all three cabinet areas supervised; approved products available; no active payment. |
| Exact steps / commands | Capture `curl --fail http://127.0.0.1:5000/hardware/status`. For each slot, use the Restock UI's per-slot Open control; physically observe CLOSED → OPEN → CLOSED. Remove/replace product as needed and compare the IR display with EMPTY/PRESENT. After every slot is PRESENT and CLOSED continuously for at least two seconds, confirm restock once. Re-run the status curl and read-only query `SELECT id,"employeeId","beforeStatus","afterStatus","notificationAttemptedAt","createdAt" FROM "RestockLog" ORDER BY id;`. |
| Expected result | Only selected slot actuates; UI follows Reed cycle and does not permit a duplicate while active; IR and Reed match physical state for slots 1–3; confirm stays disabled until all are ready; one restock log binds EMP001; configured slots become `AVAILABLE`; success UI/audio occur after commit. |
| Current result | **BLOCKED — operator physical PASS.** Face-authenticated restock passed for all three slots and products returned to available. The sensor transcript, Production RestockLog, employee linkage, and final Slot rows were not independently verified. |
| Required evidence | Sensor/status JSON before and after, continuous cabinet video, UI screenshots, one RestockLog row, Pi/backend logs. |
| Essential | **Yes.** |

### T62-P01 — Opn Test Mode QR and webhook reconciliation

| Field | Requirement |
| --- | --- |
| Preconditions | R01 passed; one approved available slot; Opn explicitly in Test Mode; signed webhook endpoint configured; operator ready at Opn dashboard; unique test transaction planned. |
| Exact steps / commands | On the kiosk select the approved slot once. Capture the returned transaction ID, amount, three-minute expiry, and QR screen. While still PENDING, perform X01. After recovery, use the Opn Test Mode dashboard's supported test completion action exactly once. Observe Opn delivery logs for `charge.complete` to `POST /api/v1/transactions/omise/webhook`, and observe kiosk polling `GET /api/v1/transactions/<ID>/payment-status`. Do not call Opn from the browser and do not update the DB manually. |
| Expected result | Amount/product come from the database; one PENDING local transaction is created; QR is provider-issued; signed webhook is accepted; backend independently retrieves and validates exact charge ID, THB amount, `paid`, status, and test mode; terminal state becomes SUCCESS once. |
| Current result | **BLOCKED — operator physical PASS.** Opn Test Mode purchases, correct slot actuation, and Thai audio passed for slots 1–3. Provider charge/webhook evidence and Production transaction rows were not independently reconciled. |
| Required evidence | Kiosk QR/status recording with sensitive QR redacted after use, Opn test-mode charge and webhook delivery screenshots, backend reconciliation logs, read-only transaction row. |
| Essential | **Yes.** |

### T62-P02 — Provider/database idempotency

| Field | Requirement |
| --- | --- |
| Preconditions | P01 completed; transaction ID and charge ID recorded; no service restart. |
| Exact steps / commands | Poll `http://127.0.0.1:3000/api/v1/transactions/<ID>/payment-status` at least three times after success. If Opn provides an approved webhook-redelivery control, redeliver the same event once; do not fabricate or edit a webhook body. In a read-only DB session run `BEGIN READ ONLY; SELECT id,"providerChargeId","paymentStatus","providerStatus","paidAt","customerCancelledAt","saleNotificationAttemptedAt" FROM "Transaction" WHERE id=<ID>; SELECT id,"slotNumber",status FROM "Slot" ORDER BY "slotNumber"; COMMIT;`. |
| Expected result | Still one Transaction/charge ID, one paid timestamp, one terminal SUCCESS, one SOLD_OUT transition for the selected slot, and one notification-attempt claim; duplicate polls/webhook do not create a second sale or notification claim. |
| Current result | **BLOCKED.** Backend automated idempotency tests passed, but Production duplicate charge/transaction checks, unresolved-payment checks, and final slot reconciliation were not run. |
| Required evidence | Redacted responses/logs for each poll/redelivery, DB query, LINE evidence cross-reference. |
| Essential | **Yes.** |

### T62-U01 — Correct slot and one observed unlock

| Field | Requirement |
| --- | --- |
| Preconditions | Same transaction as P01; camera fixed on all three locks; Pi service has not restarted; hardware health 200. |
| Exact steps / commands | Continue P01 without leaving/restarting the kiosk after recovered PENDING state. When backend returns SUCCESS, observe cabinet, kiosk, and `journalctl -u smart-vending-pi-unlock.service -b --since '<start-time>' --no-pager`. Filter the saved log for the transaction ID and `Serial unlock command sent`. |
| Expected result | Only the purchased slot receives one observed unlock pulse; other slots do not actuate; kiosk shows Success and payment-success audio; selected slot is SOLD_OUT. The result is described as “one observed unlock in an uninterrupted run,” not proof of physical dispense acknowledgement. |
| Current result | **OPERATOR-REPORTED PASS** for all three slots: the correct solenoid and Thai audio were observed. The schema has no durable physical-fulfillment record, so this physical result cannot be independently proved from PostgreSQL. |
| Required evidence | Synchronized kiosk/cabinet video, Pi log, transaction/slot query, audio observation. |
| Essential | **Yes.** |

### T62-U02 — Same-process duplicate suppression

| Field | Requirement |
| --- | --- |
| Preconditions | U01 passed; the same Pi hardware process is still running; exact transaction and slot known; cabinet supervised. |
| Exact steps / commands | Substitute numeric values and call once: `curl --fail-with-body -H 'Content-Type: application/json' --data '{"slotNumber":<SLOT>,"transactionId":<ID>}' http://127.0.0.1:5000/unlock`. Observe all locks and the Pi log. Do not repeat after a service restart. |
| Expected result | HTTP response has `deduplicated:true` and `status:"ALREADY_UNLOCKED"`; no second `OPEN`/physical pulse occurs. |
| Current result | **NOT TESTED** post-reset. Task 56 fake-Serial same-process evidence remains supporting context only. |
| Required evidence | Curl response, continuous cabinet video, filtered Pi log, service MainPID proving no restart. |
| Essential | **No** for the presentation; recommended acceptance safety check. |

### T62-U03 — Restart-safe durable exactly-once fulfillment

| Field | Requirement |
| --- | --- |
| Preconditions | None for the final audit decision. Do not reproduce this with a paid physical cabinet under Task 62. |
| Exact steps / commands | Review `docs/task56-power-reboot-acceptance.md`, `docs/task56-recovery-fix-review.md`, `edge/pi_unlock_service.py`, `edge/tests/test_task56_f3_acceptance.py`, and `frontend/tests/task56-f3-acceptance.test.mjs`. The unsafe physical sequence—restart after an uncertain unlock and repeat the same request—is prohibited unless a later design supplies a durable backend claim and an approved safety fixture. |
| Expected result | To claim durable exactly once, a repeated same-transaction request after process restart must not emit another `OPEN`. |
| Current result | **FAIL** — **ACCEPTED PROTOTYPE WAIVER**. The process-local map is lost on service restart, and an explicit repeated request reproducibly emits a second fake-Serial `OPEN`. Normal kiosk recovery from persisted `ATTEMPTING` displays staff assistance and does not issue another unlock request; no spontaneous duplicate physical unlock has been observed in that normal flow. Durable exactly-once physical unlock is not guaranteed. |
| Required evidence | Existing Task 52.6/Task 56 reports, the non-actuating fake-Serial regression, and this Tech Lead waiver. Never relabel as PASS from U01/U02 or from the safe kiosk-reload regression. |
| Essential | **Yes as a disclosed boundary.** Waiver is approved only for this supervised single-cabinet university prototype. It is invalid for unattended production deployment. |

Waiver operating controls:

- The Pi unlock service must remain loopback-only.
- Operators must never manually retry `/unlock` after an uncertain outcome.
- A lost response, unlock-service restart during unlock, or unexpected power loss
  must end in staff assistance and manual reconciliation, not an unlock retry.
- Software duplicate dispatch after an explicit post-restart retry is reproducible;
  absence of a spontaneous duplicate in normal kiosk recovery does not make U03 PASS.

### T62-X01 — Refresh guard and pending-payment reboot recovery

| Field | Requirement |
| --- | --- |
| Preconditions | P01 transaction is PENDING and unexpired; transaction ID recorded; approval for a controlled Pi reboot; cabinet supervised. |
| Exact steps / commands | Press `F5` and `Ctrl+R` once each and verify the app blocks them. Then, without cancelling/completing the charge, run the approved `sudo reboot`. Do not manually launch Chromium. After boot repeat B01 health commands and observe automatic kiosk recovery. Confirm the kiosk queries `GET /api/v1/transactions/<ID>/payment-status`, restores the same waiting payment/expiry, and has sent no unlock. Then resume P01 and complete it once. |
| Expected result | Keyboard refresh is guarded; local storage survives reboot; authoritative PENDING restores the QR/waiting flow; reboot alone causes no unlock, cancellation, duplicate transaction, or inventory change; later provider SUCCESS follows U01 once. |
| Current result | **NOT TESTED** post-reset. |
| Required evidence | Continuous screen/cabinet video across reboot, pre/post MainPID and boot ID, one transaction row, no pre-success unlock log, recovered QR/status. |
| Essential | **Yes.** Keep the reboot below the offline threshold or explicitly record any monitoring interaction. |

### T62-X02 — Terminal failure/cancellation recovery

| Field | Requirement |
| --- | --- |
| Preconditions | Separate approved Opn Test Mode transaction; no successful transaction reused; no service manipulation. |
| Exact steps / commands | Create one PENDING QR through the kiosk. Exercise one approved terminal path (Opn test failure/expiry or kiosk cancellation), then reload/reboot only if separately approved. Poll `GET /api/v1/transactions/<ID>/payment-status` and inspect the slot. Do not mutate provider/database state directly. |
| Expected result | FAILED/EXPIRED/cancelled state is authoritative; no unlock/audio-success/SOLD_OUT transition occurs; kiosk shows a retry/return path; a late success after confirmed customer cancellation is recorded but is not fulfillable. |
| Current result | **NOT TESTED** post-reset. |
| Required evidence | Provider status, kiosk recording, transaction/slot query, absence of Pi unlock log. |
| Essential | **No** for the timed demo; complete if schedule permits. |

### T62-L01 — Operational sale and restock LINE notifications

| Field | Requirement |
| --- | --- |
| Preconditions | R01 and P01 executed; approved recipient is monitoring the OA backed by `LINE_CHANNEL_ACCESS_TOKEN`; no manual send. |
| Exact steps / commands | Observe only automatic delivery produced by those flows. For the sale, verify the implemented two ordered Thai Flex cards and post-sale inventory. For restock, verify one compact Thai Flex card and EMP001 identity. Query the transaction/restock notification-attempt timestamps read-only. Do not press a retry/send control. |
| Expected result | One automatic sale notification set and one restock card; no duplicate from repeated polling/webhook; failure does not roll back sale/restock. The SmartVendingOwner report OA receives neither operational event unless requirements are changed. |
| Current result | **BLOCKED — operator PASS / partial read-only preview.** The operator reports automatic sale and inventory notifications. An existing SmartVendingMachine restock preview naming EMP001 was observed without sending a message. Production notification-attempt fields and duplicate suppression were not queried. |
| Required evidence | Recipient screenshots with timestamps/request IDs where available, redacted app logs, DB attempt-claim fields. |
| Essential | **Yes only if included in the presentation claim.** Requirements owner must confirm recipient naming. |

### T62-S01 — First Daily automatic owner report after the accepted sale

| Field | Requirement |
| --- | --- |
| Preconditions | P01 SUCCESS exists; Daily Railway Cron enabled with reviewed command `npm run report:daily:scheduled:send`, schedule `0 1 * * *`, root `/backend`, restart policy NEVER, `DEMO_TEST` selector/gate for this prototype, and owner token only. |
| Exact steps / commands | Do not run a manual send. At the first 08:00 Asia/Bangkok occurrence after the sale's local calendar day, inspect Railway job logs and the owner OA. Read-only query: `SELECT id,"reportType","dataMode","periodStart","periodEnd",status,"attemptCount","sentAt","lineRequestId" FROM "SalesReportDelivery" WHERE "reportType"='DAILY' ORDER BY id DESC LIMIT 2;`. Rerun only if the first outcome is explicitly retryable and the ledger decision is reviewed. |
| Expected result | One Daily DEMO_TEST report covers the previous Bangkok day, includes the accepted test sale once, uses test-data wording/no manual orange banner, records one durable delivery claim, and does not use employee or maintenance token. |
| Current result | **NOT TESTED**. Preserved historical delivery rows do not prove this post-reset run. |
| Required evidence | Redacted Railway config/schedule/log, owner card screenshot, delivery-ledger row, period-to-transaction reconciliation. |
| Essential | **No for live presentation; yes for scheduled-feature acceptance.** |

### T62-S02 — First Weekly automatic owner report

| Field | Requirement |
| --- | --- |
| Preconditions | Weekly Cron configured as `npm run report:weekly:scheduled:send`, schedule `0 1 * * 1`, same safety settings as S01. |
| Exact steps / commands | Wait for the first actual Monday 08:00 Asia/Bangkok run; do not substitute a manual demo send. Inspect logs, owner OA, and `SalesReportDelivery` using the S01 query with `"reportType"='WEEKLY'`. From the audit date, the next scheduled observation is 2026-11-02 08:00 ICT if the service is enabled. |
| Expected result | One blue Weekly DEMO_TEST report covers the complete previous Monday–Sunday, reconciles weekday/time-band/product totals, carries the discreet test footer, and creates one SENT ledger claim. |
| Current result | **NOT TESTED (PENDING)** until the first scheduled run. It must remain PENDING even if preview/unit tests pass. |
| Required evidence | First scheduled Railway log, owner card, ledger row, period reconciliation, duplicate-suppression observation. |
| Essential | **No.** This may remain a named post-review observation, but may not be described as PASS. |

### T62-H01 — Healthy heartbeat remains ONLINE

| Field | Requirement |
| --- | --- |
| Preconditions | Relay active with reviewed 30-second heartbeat; backend loop active; no outage drill yet. |
| Exact steps / commands | Observe at least three intervals. On Pi run `journalctl -u smart-vending-pi-cloud-relay.service --since '-3 minutes' --no-pager`. In a secure read-only DB session run `SELECT "machineId",connectivity,"lastHeartbeatAt","lastObservedAt","lastSequence","offlineCandidateSince","offlineSince" FROM "HardwareMachine";`. |
| Expected result | `PILOT_KIOSK` advances sequence/server receive time, remains ONLINE, and creates no new alert/message while healthy. Heartbeat remains independent of Chromium, hardware status, and Serial. |
| Current result | **NOT TESTED** post-reset. |
| Required evidence | Relay/backend logs, before/after machine row, unchanged alert count. |
| Essential | **No** for presentation; prerequisite to H02. |

### T62-H02 — VendingMaintenance OFFLINE and RECOVERED

| Field | Requirement |
| --- | --- |
| Preconditions | H01 passed; approved maintenance window; VendingMaintenance recipient watching; payment/restock idle; explicit permission to stop/start only the cloud relay and trigger two LINE messages. |
| Exact steps / commands | Record alert count and relay MainPID. Run `sudo systemctl stop smart-vending-pi-cloud-relay.service`. Leave Pi unlock/frontend/Chromium/ESP32 untouched. Observe first stale evaluation and later confirmation; allow approximately 3–5 minutes. Verify exactly one OFFLINE event/card. Run `sudo systemctl start smart-vending-pi-cloud-relay.service`; verify health with `curl --fail http://127.0.0.1:3000/health`; within the designed interval verify one newer heartbeat, one RECOVERED event/card, and no duplicates. Inspect `journalctl -u smart-vending-pi-cloud-relay.service -b --no-pager` and read-only Hardware rows. |
| Expected result | One continuous outage creates exactly one OFFLINE event/message; recovery creates exactly one RECOVERED event/message, normally delivered by the 30-second loop within 60 seconds; only maintenance token/OA is used; business and unlock tables do not change. |
| Current result | **BLOCKED — operator physical PASS.** OFFLINE arrived after approximately four minutes and RECOVERED after approximately one minute. An existing VendingMaintenance recovery preview was observed read-only; the two new event rows, delivery metadata, and absence of duplicates were not queried. |
| Required evidence | Synchronized Pi/backend/Railway logs, two maintenance OA screenshots, two new DB event rows and immutable delivery metadata, unchanged business-table snapshot. |
| Essential | **No for live presentation; yes before final monitoring acceptance unless explicitly deferred.** Run last to avoid disrupting core demo. |

### T62-Q01 — Error handling and user recovery paths

| Field | Requirement |
| --- | --- |
| Preconditions | Core happy path complete; supervised cabinet; no paid transaction may be placed into an intentionally uncertain unlock state. |
| Exact steps / commands | (a) At idle, temporarily remove Pi network only if combined with H02; kiosk must show a connection/load error and recover when network returns. (b) Disconnect ESP32 at idle if approved; `curl -i http://127.0.0.1:5000/health` and `/hardware/status` must return 503, Restock controls must fail closed, then automatic by-id recovery must restore fresh status without `OPEN`. (c) Perform the one static-face failure in F02 and verify retry/cancel. (d) Use X02 for payment terminal failure. (e) Do not physically force a post-payment unlock failure; use automated test evidence for the assistance-only/no-auto-retry UI unless a safe fixture is separately approved. |
| Expected result | Errors are explicit and recoverable; customer/staff screens do not invent success; hardware/face failures fail closed; recovery never replays unlock; paid-but-uncertain fulfillment tells the user to seek staff and preserves SUCCESS/SOLD_OUT without automatic refund. |
| Current result | **NOT TESTED** post-reset. Backend/frontend portions passed under A01; fresh Pi portions await A02. |
| Required evidence | UI video/screenshots for each exercised path, status codes, relevant logs, no unexpected `OPEN`, DB before/after. |
| Essential | **No** for timed presentation. Do only safe, approved subcases. |

### T62-D02 — Final reconciliation and configuration preservation

| Field | Requirement |
| --- | --- |
| Preconditions | All approved tests finished; no active QR/staff session; all evidence IDs known. |
| Exact steps / commands | Repeat D01 Product and Slot-configuration queries. Also run `BEGIN READ ONLY; SELECT status,count(*) FROM "Transaction" GROUP BY status ORDER BY status; SELECT count(*) FROM "Employee"; SELECT count(*) FROM "RestockLog"; SELECT count(*) FROM "KioskSession"; SELECT count(*) FROM "SalesReportDelivery"; SELECT count(*) FROM "HardwareAlertEvent"; SELECT count(*) FROM _prisma_migrations; COMMIT;`. Reconcile every delta to an approved test ID. |
| Expected result | Product rows and slot identity/product assignment/configuration remain unchanged; only expected slot status changes occurred; migrations remain 15; Employee/Transaction/Restock/session/report/alert deltas exactly match executed tests; no unexplained row or active session remains. |
| Current result | **BLOCKED.** No usable Production read-only database session was available, so transaction, inventory, employee, restock, session, report, alert, Product, Slot, and migration deltas were not reconciled. |
| Required evidence | Before/after CSV/hash, delta ledger mapping rows to test IDs, final active-session check, incident note for any mismatch. |
| Essential | **Yes.** Any unexplained delta blocks closure. |

### T62-M01 — Timed presentation rehearsal

| Field | Requirement |
| --- | --- |
| Preconditions | Essential cases passed or their evidence is ready; cabinet restored to a known state; U03 limitation and Weekly PENDING wording approved. |
| Exact steps / commands | Perform the demo script in section 6 once without creating additional employee/payment/report records unless explicitly designated as the final accepted transaction. Time every segment and rehearse operator handoffs. |
| Expected result | Demo completes within the allotted presentation time, uses the correct OA terminology, includes one supervised happy-path vend, and states limitations without claiming durable exactly once or Weekly PASS. |
| Current result | **NOT TESTED**. |
| Required evidence | Timed rehearsal checklist, presenter/operator names, fallback screenshots/video, final cabinet state. |
| Essential | **Yes.** |

## 5. Physical acceptance sequence

Use one evidence folder named with the date and revision. Do not place credentials,
face templates, QR secrets, or raw JWT/webhook bodies in it.

1. **Freeze and identify:** record revision, deployed Railway revision, Pi revision,
   firmware source hash/version claim, operator names, Bangkok time, and existing
   dirty-tree exceptions. Do not pull/deploy in this task.
2. **Read-only reset baseline:** execute D01 and stop on any mismatch.
3. **Idle cold boot:** execute B01 while filming all locks.
4. **Read-only cloud check:** execute C01 and H01.
5. **First identity:** execute E01, then F01. Confirm `EMP001` before enrollment.
6. **Staff path:** execute F02 and R01. Use this one restock for its LINE check.
7. **Single payment path:** start P01, exercise X01 while PENDING, then complete the
   Opn Test Mode charge once and execute U01/P02. Do not restart the Pi hardware
   service after an uncertain unlock.
8. **Optional same-process check:** execute U02 only while the original Pi service
   MainPID is unchanged.
9. **Notifications:** collect L01 evidence. Do not manually resend.
10. **Safe error cases:** execute only approved X02/Q01 subcases; omit an unsafe
    paid-unlock fault injection.
11. **Monitoring last:** execute H02 after customer/staff flows so the intentional
    relay outage cannot contaminate their results.
12. **Final read-only reconciliation:** execute D02 and close active sessions.
13. **Scheduled observations:** observe S01 on the next 08:00 Bangkok Daily run.
    Keep S02 PENDING until the first Monday 08:00 Bangkok run.
14. **Rehearse presentation:** execute M01. Do not repeat a payment merely to make
    the presentation look fresh; use approved evidence where a second side effect
    is unnecessary.

Stop the sequence immediately for: unexpected solenoid actuation, wrong slot,
different first employee code, non-Test-Mode payment, unexplained DB delta,
unrecoverable hardware/camera failure, duplicated notification/unlock, exposed
secret/biometric data, or an active uncertain payment/unlock outcome.

## 6. Presentation demo script (target 8–10 minutes)

| Time | Presenter action | Expected audience-visible result | Fallback |
| --- | --- | --- | --- |
| 0:00–0:45 | State scope: one supervised prototype, Opn Test Mode, three physical slots. Show revision/reset baseline. | Clear safety boundary; no Production/public-deployment claim. | D01 screenshot. |
| 0:45–1:30 | Power on or show continuous approved cold-boot recording. | Services and Chromium start automatically; customer screen appears; no lock moves. | B01 video/logs. |
| 1:30–2:15 | Show the three kiosk products and read-only cloud slot JSON. | Pi displays Railway-backed names/prices/statuses. | C01 capture. |
| 2:15–3:15 | In Admin, show EMP001 and start enrollment, or show approved enrollment evidence if already enrolled. | Random head turn, return to center, registration success. | F01 recording; never re-enroll/overwrite. |
| 3:15–4:30 | From Staff, start Restock; authenticate EMP001; show one IR/Reed change and final ready state. | Face auth succeeds; selected door cycle and sensors are truthful; restock commits. | F02/R01 evidence. |
| 4:30–6:30 | Select one available product, show Test Mode QR, complete it once in Opn. | Webhook/poll reconciles SUCCESS; correct slot unlocks once; kiosk success/audio; selected slot SOLD_OUT. | P01/U01 synchronized video. |
| 6:30–7:15 | Show transaction/slot row and Operational LINE OA evidence. | One transaction, one sale claim, correct inventory, one operational sale notification; do not claim the Owner OA receives per-sale messages. | P02/L01 captures. |
| 7:15–8:00 | Show scheduled Daily evidence from the Owner LINE OA and OFFLINE/RECOVERED evidence from the VendingMaintenance LINE OA rather than triggering either live. | Operational, Owner-report, and Maintenance OA responsibilities are clear. | S01/H02 screenshots/logs. |
| 8:00–9:00 | Close with limitations. | State: Weekly is PENDING; restart-safe physical exactly once is not implemented; uncertain outcome requires staff; liveness is prototype-grade. | This document's limitations section. |

## 7. Known limitations and deferred items

1. **T62-U03 remains FAIL under an accepted prototype waiver.** Process-local Pi
   deduplication is acceptable only for the uninterrupted supervised flow. An
   explicit repeated request after unlock-service restart can dispatch another
   Serial `OPEN`; durable exactly-once physical unlock is not guaranteed. No
   spontaneous duplicate physical unlock has been observed in normal kiosk
   recovery: persisted `ATTEMPTING` routes to staff assistance without another
   unlock request. The service must remain loopback-only, operators must never
   manually retry `/unlock` after an uncertain result, and lost response, service
   restart during unlock, or unexpected power loss requires staff assistance.
   This waiver is invalid for unattended production deployment. Durable backend
   unlock claims and a correlated ESP32 protocol remain deferred.
2. **Serial write is not dispense proof.** `UNLOCK_COMMAND_SENT` does not wait for
   `ACK:OPEN:n`; relay-cycle messages do not prove lid movement; Reed reports door
   position and IR reports product presence, not customer collection.
3. **Weekly scheduled report is PENDING.** Unit tests, preview, a manual send, or
   preserved old delivery rows cannot replace the first scheduled observation.
4. **Live infrastructure is not reproducible from Git.** Railway/Cloudflare/Opn/LINE
   settings need redacted provider evidence and an owner/rotation record.
5. **Face liveness is prototype-grade.** A monocular RGB head turn is not certified
   PAD and may not resist responsive replay, manipulated video, or 3-D attacks.
6. **Cloudflare Access is not application RBAC.** The same approved human Access
   group can reach Staff and Admin; route separation is UI/API design, not distinct
   staff/admin identities in Express.
7. **Notification delivery has external limits and separate responsibilities.** A
   LINE 200/accepted retry key proves API acceptance, not that a human read the
   message. The Operational OA receives sale/restock notifications, the Owner OA
   receives scheduled Daily/Weekly Sales Reports, and the VendingMaintenance OA
   receives Pi OFFLINE/RECOVERED alerts. The Owner OA does not receive per-sale
   notifications; all three OAs must remain separately credentialed.
8. **No automatic refund.** A paid sale remains SUCCESS/SOLD_OUT if local unlock
   fails; staff reconciliation is required.
9. **Local and Railway databases are not synchronized.** Railway is authoritative
   for the cloud demonstration.
10. **Backup restoration remains untested** per Task 60; backup checksum verification
    is not a restore drill.
11. **Scope deferral:** advanced PAD, mobile app, MQTT, offline sync, OTA, automatic
    refunds, multi-cabinet identity/reporting, and production observability are out
    of the remaining internship prototype scope.

## 8. Evidence checklist

- [ ] Tech Lead approval for the exact physical/payment/LINE/monitoring window.
- [ ] Revision IDs: repository, Railway deployment, Pi checkout, firmware claim.
- [ ] Task 61 script hash, execution transcript, backup ID, and final read-only export.
- [ ] D01 before snapshot and D02 after/delta reconciliation.
- [x] Task 62.2E operator physical-result statement recorded separately from DB evidence.
- [x] Existing LINE chat-list previews inspected read-only; no message/retry sent.
- [ ] Backend/frontend automated logs plus fresh Pi edge/face test logs.
- [ ] Continuous cold-boot and cabinet safety video.
- [ ] `systemctl`, current-boot journal, local health/status, and relay slots output.
- [ ] Redacted Railway and Cloudflare deployment/configuration evidence.
- [ ] EMP001 creation and safe face-registration metadata; no face data retained.
- [ ] Both physical head-turn directions, static-media failure, cancel/retry evidence.
- [ ] IR/Reed readings for all three slots and one RestockLog.
- [ ] Opn Test Mode charge, signed webhook delivery, polling, and DB reconciliation.
- [ ] Synchronized correct-slot video and Pi log for the accepted transaction.
- [ ] Duplicate poll/webhook and, if run, same-process dedup evidence.
- [ ] Operational LINE sale/restock evidence with no duplicate.
- [ ] Daily scheduled report evidence.
- [ ] Weekly item explicitly labeled **PENDING** until first scheduled run.
- [ ] Healthy heartbeat plus one OFFLINE/one RECOVERED event and Maintenance OA cards.
- [ ] Error/recovery evidence for each safely exercised subcase.
- [x] U03 Tech Lead waiver recorded as **ACCEPTED PROTOTYPE WAIVER**; U03 remains
  **FAIL**, with fake-Serial safe-recovery and explicit-retry regression evidence.
- [ ] Timed presentation rehearsal and fallback evidence pack.
- [ ] Incident list is empty or each item has a named owner and disposition.

## 9. Criteria for Task 62 CLOSED

Task 62 may be marked CLOSED only when all of the following are true:

1. D01 proves the reported Task 61 state and approved Product/Slot assignments
   before any acceptance mutation.
2. Every **essential** post-reset case except U03 has new evidence and is PASS:
   B01, C01, E01, F01, F02, R01, P01, P02, U01, X01, D02, and M01. A feature
   omitted from the live presentation can still require acceptance evidence.
3. A02 has a fresh passing Pi Python run in addition to the recorded A01
   backend/frontend PASS.
4. No wrong-slot event, unintended unlock, unexplained DB delta, leaked secret or
   biometric, duplicate sale/notification, active session, or unresolved payment
   remains.
5. U03 remains **FAIL**. The Tech Lead-approved **ACCEPTED PROTOTYPE WAIVER**
   satisfies disposition only for this supervised single-cabinet prototype, with
   loopback-only Pi access, no manual/automatic retry after an uncertain unlock,
   staff assistance after lost response/service restart/power loss, and no claim
   of durable exactly once. The waiver cannot support unattended production.
6. LINE evidence follows the confirmed routing: Operational OA for sale/restock,
   Owner OA for scheduled Daily/Weekly Sales Reports, and VendingMaintenance OA
   for Pi OFFLINE/RECOVERED. Per-sale delivery to the Owner OA is not required and
   must not be claimed.
7. S01 has either passed its first eligible Daily scheduled run or has a named,
   dated observation owner accepted by the Tech Lead. S02 remains **NOT TESTED
   (PENDING)** until its first scheduled Weekly run; closure must not relabel it.
8. H02 is PASS, or is explicitly deferred with a named owner/date and no claim that
   live Maintenance OA delivery was verified post-reset.
9. D02 reconciles all mutations and the complete evidence checklist is stored in
   the approved private location.
10. Tech Lead signs the final matrix and authorizes closure. This document must
    stop at review; it does not authorize commit, deploy, provider changes, or
    physical execution.

## 10. Repository sources inspected

- `README.md`, `PROJECT_CONTEXT.md`, and repository/package scripts
- `docs/task54-slot-management.md`, `docs/task55-firmware-hardware-source-of-truth.md`
- `docs/task56-power-reboot-acceptance.md`, `docs/task56-recovery-fix-review.md`
- `docs/task59-cloud-deployment-preparation.md`, `docs/task60-cloud-acceptance.md`
- Pi kiosk/autostart/cloud-relay/face/unlock/payment/reporting/monitoring guides
- Task 61 SQL/readme, Prisma schema and all 15 migrations
- Backend routes/controllers/services/tests for employee, restock, payment,
  notification, reporting, Cloudflare origin guard, and hardware heartbeat
- Frontend customer/staff/admin, payment recovery, face, restock, and UI tests
- Pi relay/unlock/serial/face code, systemd units, ESP32 firmware, and test suites

