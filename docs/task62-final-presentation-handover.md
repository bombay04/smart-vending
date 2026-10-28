# Task 62.3A — Final Presentation and Handover Package

**Project:** Smart Vending Machine  
**Scope:** supervised, single-cabinet university internship prototype  
**Prepared:** 2026-10-28 (Asia/Bangkok)  
**Status:** presentation package prepared for Tech Lead review; no deployment action authorized

## 1. Evidence language used in this package

| Label | Meaning |
| --- | --- |
| **[REPO]** | Implemented behavior or configuration verified from repository code/documentation. |
| **[AUTO]** | Automated test result supplied for the reviewed revision. It does not prove physical actuation. |
| **[PHYSICAL]** | Result observed and confirmed by the cabinet operator during final acceptance. |
| **[DB]** | Result confirmed by read-only Railway Production reconciliation. |
| **[PENDING]** | Required observation has not yet occurred and must not be presented as PASS. |
| **[DEFERRED]** | Deliberately outside the accepted one-cabinet scope; not a hidden PASS. |
| **[WAIVER]** | Known failure explicitly accepted only for the supervised prototype. |

The confirmed Task 62.3A status supersedes the earlier reconciliation-blocked
snapshot in `docs/task62-final-e2e-acceptance.md`. That acceptance document still
needs a controlled final-status reconciliation during Task 62.3B; this package
does not silently rewrite its evidence history.

## 2. Project objective and prototype scope

The project demonstrates an end-to-end smart vending workflow for a university
internship: a customer selects one of three products, pays through an Opn
PromptPay QR in Test Mode, and the correct physical compartment unlocks. Staff
can authenticate locally by face, inspect the cabinet sensors, and restock all
three compartments. Railway PostgreSQL preserves the business records, while
separate LINE Official Accounts provide operational, owner-reporting, and
maintenance communication. **[REPO][PHYSICAL][DB]**

The accepted scope is one supervised cabinet with three transparent
compartments. It is a controlled prototype, not an unattended retail deployment.
It does not claim Live Mode financial settlement, production biometric security,
or durable exactly-once physical fulfillment across every crash window.

The configured demonstration mapping is:

| Slot | Product | Demonstration price |
| ---: | --- | ---: |
| 1 | Tissue | THB 20 |
| 2 | Sanitary Pad | THB 25 |
| 3 | Wet Wipes | THB 30 |

The final three accepted transactions total **THB 75**. **[DB]**

## 3. Actual deployed architecture

```text
Customer touchscreen                         Staff/Admin browser
Chromium + React/Vite                        /staff and /admin
on Raspberry Pi 3B+                          through human Cloudflare Access
        |                                                   |
        | HTTP loopback                                     |
        v                                                   v
Pi Cloud Relay :3000  ---> Cloudflare Service Auth ---> Railway Express API
  allowlisted routes          pi-api hostname             |       |       |
  machine credential hidden                              Prisma   Opn     LINE
                                                         |        Test    APIs
                                                         v        Mode
                                                   Railway PostgreSQL

React kiosk ---> Pi Hardware/Face/Audio API :5000 (loopback only)
                         |               |              |
                         | USB Serial    | USB camera   | ALSA/USB speaker
                         v               v              v
                       ESP32         YuNet/SFace      Thai WAV audio
                         |
                 3 relays/solenoids + 3 reed + 3 IR sensors
```

### Deployed responsibility boundaries

- **Railway:** Express/TypeScript backend, Prisma, PostgreSQL, payment
  reconciliation, inventory, employees, kiosk sessions, restock logs, report
  delivery ledger, and monitoring ledger. **[REPO][DB]**
- **Cloudflare:** human Access for the Staff/Admin hostname; dedicated Service
  Auth for the Pi API hostname; exact public exception only for the signed Opn
  webhook. **[REPO]**
- **Raspberry Pi:** Chromium kiosk, React/Vite frontend, allowlisted cloud relay,
  local hardware/face/audio Flask service, camera, and speaker. The cloud relay
  initiates outbound requests; Railway does not connect inbound to Pi hardware.
  **[REPO][PHYSICAL]**
- **ESP32:** one-at-a-time solenoid relay control and IR/reed sensing over
  115200-baud USB Serial. **[REPO][PHYSICAL]**
- **External services:** Opn Test Mode for PromptPay QR and three separate LINE
  OA channels for operations, owner reports, and maintenance. **[REPO][PHYSICAL]**

## 4. Hardware and software components

### Hardware

| Component | Role |
| --- | --- |
| Raspberry Pi 3B+ | Runs Chromium, the kiosk frontend, relay, face/hardware/audio service, and local recovery logic. |
| Touch display | Customer kiosk and local staff workflow display. |
| USB webcam | Local-only enrollment, recognition, and head-turn challenge. |
| USB speaker | Plays allowlisted Thai payment/restock/authentication/failure WAV events through ALSA. |
| ESP32 Dev Module | Executes `OPEN:n`, reads door and product sensors, and applies the one-relay interlock. |
| Three relay/solenoid locks | Momentarily unlock the selected cabinet slot; firmware target pulse is 700 ms. |
| Three reed switches | Report lid `OPEN`/`CLOSED`; this is separate from relay-cycle status. |
| Three IR sensors | Report product `PRESENT`/`EMPTY`; they do not decide whether payment succeeded. |

### Software

| Layer | Main technology |
| --- | --- |
| Frontend | React, Vite, TypeScript; customer `/`, remote `/staff`, remote `/admin`. |
| Backend | Node.js, TypeScript, Express 5, Prisma, PostgreSQL. |
| Pi services | Python, Flask, pyserial, OpenCV YuNet/SFace, ALSA `aplay`. |
| Firmware | Arduino-style ESP32 sketch with Serial commands and active-LOW relay outputs. |
| Deployment | Railway services/PostgreSQL, Cloudflare Tunnel/Access, Raspberry Pi systemd and graphical autostart. |

Primary repository sources: `README.md`, `backend/prisma/schema.prisma`,
`docs/project-spec.md`, `docs/pi-autostart.md`, `docs/pi-cloud-relay.md`,
`docs/task55-firmware-hardware-source-of-truth.md`, and
`docs/serial-protocol.md`.

## 5. Customer purchase workflow

1. Chromium starts at the customer screen and loads the three assigned slots
   through the Pi Cloud Relay. Only `AVAILABLE` products are selectable.
2. The customer selects a slot. The backend—not the browser—loads its product and
   Decimal price from PostgreSQL.
3. The backend creates one local `PENDING` transaction and one Opn PromptPay
   charge with a three-minute expiry. The browser receives only safe display and
   QR fields.
4. Opn Test Mode completion reaches the signed webhook and/or the kiosk's status
   polling path. In either case, the backend retrieves the stored charge and
   verifies charge ID, THB amount, currency, paid flag, status, and test mode.
5. In one database transaction, the backend changes `Transaction` to `SUCCESS`
   and the selected `Slot` to `SOLD_OUT`. Duplicate webhook/poll reconciliation
   is idempotent.
6. Only after backend-confirmed success does the kiosk persist fulfillment state
   and call the loopback Pi `/unlock` endpoint for the selected slot.
7. Pi writes `OPEN:n` to ESP32. The correct solenoid unlock, Thai audio, success
   screen, and Operational LINE sale/remaining-stock notification follow.

Final evidence: Slots 1, 2, and 3 passed in Opn Test Mode; the three Production
transactions are successful and total THB 75; the correct solenoid and Thai
audio were observed for each purchase. **[PHYSICAL][DB]**

## 6. Staff face-authenticated restock workflow

1. Staff opens `/staff` through human Cloudflare Access and starts a short-lived
   `RESTOCK_AUTH` kiosk session.
2. The safely idle Pi detects that session through the allowlisted relay and
   opens the local face workflow.
3. YuNet/SFace and the head-turn/return-to-center challenge run on the Pi. Face
   images and templates do not pass through Railway. Pi returns only the matched
   employee code.
4. The backend verifies that the kiosk session is active and that EMP001 exists
   and is active. A match from Pi alone is not authorization.
5. Restock Mode opens one authorized slot at a time. Reed state confirms the lid
   cycle; IR state confirms product presence. Confirmation remains disabled until
   all three slots are present and closed stably.
6. The backend transaction creates a `RestockLog`, changes all three configured
   slots from `SOLD_OUT` to `AVAILABLE`, and completes the session.
7. Operational LINE receives the restock notification and the Pi plays the Thai
   restock-complete audio.

Final evidence: EMP001 enrollment/authentication passed; all three slots passed
face-authenticated restock; Railway `RestockLog` records the three-slot
`SOLD_OUT` to `AVAILABLE` transition; all slots remained `AVAILABLE` afterward.
**[PHYSICAL][DB]**

Cloud Face Template Sync is deferred. The Pi is the authority for local template
existence, while Railway `faceRegistered` is workflow metadata only.
**[DEFERRED]**

## 7. LINE OA responsibilities

| LINE OA | Responsibility | Final status |
| --- | --- | --- |
| Operational LINE OA (`LINE_CHANNEL_ACCESS_TOKEN`) | Per-sale cards, remaining-stock information, and restock notification. | Sale/inventory and restock delivery observed. **[PHYSICAL]** |
| Owner LINE OA (`LINE_OWNER_CHANNEL_ACCESS_TOKEN`) | Scheduled Daily and Weekly Sales Reports only. It does not receive per-sale notifications. | Daily/Weekly implementation and delivery ledger exist; this package makes no new scheduled-run PASS claim. First verified automatic Weekly execution remains pending. **[REPO][PENDING]** |
| VendingMaintenance LINE OA (`LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN`) | Pi connectivity `OFFLINE` and `RECOVERED` alerts. | OFFLINE arrived in about four minutes; RECOVERED in about one minute. **[PHYSICAL][DB]** |

The connectivity monitor sends a heartbeat approximately every 30 seconds. It
monitors the Pi Cloud Relay's reachability, not solenoids, IR/reed sensors,
Chromium, or physical dispensing.

## 8. Payment, inventory, and physical authority

| Question | Authority |
| --- | --- |
| Did payment succeed? | Opn charge retrieved and validated by the Railway backend. The QR, webhook body, browser, and ESP32 cannot declare success. |
| Is a product available for sale? | Railway PostgreSQL `Slot.status`. Sensors support restock validation but do not replace inventory state. |
| Which employee may restock? | Active Railway employee plus active kiosk session, after Pi-local face matching. |
| Does a face template exist? | The Raspberry Pi's local face store. Railway holds only workflow metadata. |
| Did the Pi dispatch an unlock command? | Pi service and Serial logs. A successful write is not a physical acknowledgement. |
| Did the physical lid unlock/open? | Operator observation plus reed behavior. PostgreSQL has no durable physical-fulfillment ledger. |

Payment success is not rolled back if local unlock fails, and the prototype has
no automatic refund. Any paid-but-uncertain physical outcome requires staff
reconciliation.

## 9. Security controls and recovery behavior

- Pi cloud credentials remain in a root-owned relay environment; the browser
  never receives them. Relay methods and paths are explicitly allowlisted.
- Cloudflare verifies the dedicated Pi service token; the Express origin guard
  independently verifies the Access JWT, audience, issuer, identity, method, and
  path.
- The hardware/face/audio service remains bound to loopback port 5000 and is not
  exposed through Railway, Cloudflare, or the LAN.
- Face templates, embeddings, frames, crops, and landmarks remain local to the
  Pi. Railway receives employee metadata and safe result codes only.
- Employee authentication and hardware failures fail closed. Three counted face
  failures cause a three-minute process-local lockout.
- The customer refresh guard blocks ordinary browser refresh shortcuts during
  the kiosk flow. Active payment recovery uses authoritative backend status plus
  a small persisted browser fulfillment state.
- systemd restarts the frontend, Pi service, and relay after process failure;
  Chromium graphical autostart waits for stable frontend readiness.
- Serial reconnect never automatically replays an uncertain `OPEN` command.
- A lost unlock response, Pi unlock-service restart during the crash window, or
  unexpected power loss after dispatch must show/lead to staff assistance.
  Operators must never manually repeat `/unlock` for that transaction.
- `/staff` and `/admin` are protected by the prototype's human Cloudflare Access
  group, but the application does not implement distinct staff-versus-admin
  identities/RBAC. This is acceptable only within the controlled prototype.

Refresh Guard and the normal cold reboot passed final physical acceptance.
**[PHYSICAL]**

## 10. Final acceptance evidence

| Claim | Automated | Operator-observed | Railway read-only | Status |
| --- | --- | --- | --- | --- |
| Cold boot opens Chromium and renders products | Startup/recovery coverage | Observed | N/A | PASS |
| EMP001 enrollment and authentication | Frontend/backend/face contracts | Observed | EMP001 metadata reconciled | PASS |
| Three Opn purchases | Payment/provider tests | Slots 1–3 observed | 3 SUCCESS, THB 75 | PASS in Test Mode |
| Correct-slot unlock and Thai audio | Fake Serial/audio tests | Slots 1–3 observed | No physical ledger | PASS for observed runs |
| Sale/inventory LINE messages | Notification tests | Observed | Transaction claim fields reconciled | PASS |
| Three-slot restock | Restock/session/sensor tests | Observed | RestockLog and final Slot state reconciled | PASS |
| Final inventory | Slot/inventory tests | All three available on kiosk | Slots 1–3 `AVAILABLE` | PASS |
| Refresh Guard and normal cold reboot | Recovery tests | Observed | No unexpected business delta | PASS |
| Pi OFFLINE/RECOVERED | Monitoring state-machine tests | About 4 min / 1 min | Alert ledger reconciled | PASS |
| Backend regression | 193/193 | N/A | N/A | PASS |
| Frontend regression | 138/138 | N/A | N/A | PASS |
| Python fake-Serial crash-window suite | 5 tests passed; 6 subtests passed | Non-actuating | N/A | PASS as a regression; U03 remains FAIL |
| Durable exactly-once physical unlock across restart | Reproducible second fake `OPEN` after explicit post-restart retry | No spontaneous duplicate observed in normal kiosk recovery | No durable claim exists | **FAIL — ACCEPTED PROTOTYPE WAIVER** |
| Weekly scheduled report | Implementation tests only | First automatic run not yet verified | Ledger result pending | **PENDING** |

## 11. Claim-to-evidence map

| Major presentation claim | Evidence class | Source |
| --- | --- | --- |
| Three-slot single-cabinet scope and product mapping | **[REPO]** | `docs/project-spec.md` |
| Pi/ESP32/Railway/Cloudflare boundaries | **[REPO]** | `README.md`, `docs/pi-cloud-relay.md`, `docs/staff-admin-cloud.md` |
| Automatic Pi services and Chromium startup | **[REPO][PHYSICAL]** | `docs/pi-autostart.md`, `docs/pi-kiosk.md`, final operator acceptance |
| Correct ESP32 commands and sensor semantics | **[REPO]** | `firmware/vending_esp32.ino`, `docs/serial-protocol.md`, Task 55 audit |
| Payment authority and atomic SUCCESS/SOLD_OUT transition | **[REPO][AUTO][DB]** | `docs/opn-payments.md`, backend payment tests, final Railway reconciliation |
| Three transactions total THB 75 | **[DB]** | Final read-only Railway reconciliation supplied for Task 62.3A |
| Physical unlock and Thai audio for all slots | **[PHYSICAL]** | Final operator acceptance supplied for Task 62.3A |
| Face data remains local | **[REPO][AUTO]** | `docs/project-spec.md`, `docs/pi-face-recognition.md`, Pi/frontend tests |
| EMP001 and successful restock linkage | **[PHYSICAL][DB]** | Final operator acceptance and Railway reconciliation |
| Operational/Owner/Maintenance LINE separation | **[REPO]** | Phase 2 owner reports, Phase 3 monitoring, Task 62 waiver update |
| OFFLINE/RECOVERED timing | **[PHYSICAL][DB]** | Final operator acceptance and HardwareAlertEvent reconciliation |
| Refresh and reboot recovery | **[PHYSICAL][AUTO]** | Final operator acceptance, Task 56, frontend recovery tests |
| Regression totals 193/193 and 138/138 | **[AUTO]** | Final supplied test logs; `docs/task62-final-e2e-acceptance.md` |
| Fake Serial 5 tests / 6 subtests | **[AUTO]** | `edge/tests/test_task56_f3_acceptance.py`, final supplied test log |
| U03 restart-safe exactly-once limitation | **[AUTO][WAIVER]** | Task 56 acceptance, Task 62 waiver, frontend recovery regression |
| Weekly report status | **[PENDING]** | `docs/phase2-owner-sales-reports.md`; first automatic run not verified |
| Cloud Face Template Sync | **[DEFERRED]** | Single-Pi local-template architecture; explicitly deferred for this prototype |

## 12. Known limitations and deferred work

1. **T62-U03 remains FAIL under an accepted prototype waiver.** Pi unlock
   deduplication is process-local. An explicit retry after service restart can
   dispatch another Serial `OPEN`. Durable exactly-once physical unlock is not
   guaranteed. Keep the service loopback-only and never retry an uncertain
   transaction. The waiver is invalid for unattended production.
2. **Opn is Test Mode.** THB 75 is test transaction value, not Live Mode revenue.
3. **Weekly report remains PENDING.** Do not replace the first verified automatic
   scheduled execution with a preview or manual send.
4. **Cloud Face Template Sync is deferred.** Replacing the Pi or adding cabinets
   requires a controlled local-template enrollment/migration process.
5. Serial-write success does not prove ESP32 acknowledgement, solenoid motion,
   lid movement, or product collection.
6. Face liveness is a monocular head-turn challenge, not certified
   presentation-attack detection or production biometric security.
7. The monitoring feature covers relay-to-cloud connectivity only, not the
   cabinet's sensors, locks, camera, audio, or Chromium health.
8. No automatic refund or automatic physical retry exists after paid-but-uncertain
   fulfillment.
9. Human Cloudflare Access protects the portals, but application-level staff/admin
   RBAC is deferred.
10. Multi-cabinet identity, offline sales/synchronization, OTA firmware updates,
    MQTT, production observability, and disaster-recovery restore testing are out
    of the accepted internship scope.

## 13. Live demonstration script (8–12 minutes)

| Time | Presenter action | Expected result | Fallback evidence |
| --- | --- | --- | --- |
| 0:00–0:45 | State scope: one supervised three-slot cabinet, Opn Test Mode, separate cloud/local authority. | Audience understands this is a prototype, not Live retail. | Architecture slide. |
| 0:45–1:30 | Power on, or show continuous cold-boot recording. | Chromium opens automatically to the customer screen; no lock moves. | Boot video plus service-status capture. |
| 1:30–2:15 | Show all three product cards and availability. | Slots 1–3 display and are selectable as `AVAILABLE`. | Kiosk screenshot and Railway Slot query. |
| 2:15–4:00 | Select one product and show the Opn Test Mode QR. Complete only the approved test charge. | Waiting screen becomes success; correct slot unlocks once; Thai audio plays; selected slot becomes `SOLD_OUT`. | Redacted QR/Opn/webhook capture and accepted transaction video. |
| 4:00–4:45 | Show Operational LINE evidence and read-only transaction summary. | Sale/remaining-stock notification and one successful transaction are visible; no Owner-OA per-sale claim. | Redacted LINE and Railway screenshots. |
| 4:45–6:30 | Start Restock from `/staff`, authenticate EMP001, demonstrate one safe slot cycle, then show accepted all-slot restock evidence. | Face challenge passes; Restock Mode opens; sensor state is truthful; confirmation returns all slots to `AVAILABLE`; Thai restock audio plays. | Enrollment/auth/restock video and RestockLog screenshot. |
| 6:30–7:15 | Show VendingMaintenance OFFLINE/RECOVERED captures rather than waiting live. | OFFLINE ≈4 minutes and RECOVERED ≈1 minute are visible with distinct timestamps. | Alert ledger and LINE screenshots. |
| 7:15–8:15 | Show final evidence dashboard/table. | 3 SUCCESS transactions, THB 75, all slots `AVAILABLE`, RestockLog, and regression totals are clear. | Pre-redacted evidence montage. |
| 8:15–9:00 | Close with limitations. | State U03 FAIL/waiver, Opn Test Mode, Weekly PENDING, and face sync deferred. | Limitations slide and signed waiver reference. |

Do not improvise a second unlock, service restart, payment retry, LINE send, or
database edit during the presentation. If the live path becomes uncertain, stop
and use the evidence fallback.

## 14. Operator startup, shutdown, and recovery checklist

### Safe startup

- [ ] Confirm cabinet doors are closed, no person is touching a lock, and no
  payment or restock session is active.
- [ ] Power the cabinet/Pi using the approved procedure; do not manually open
  Chromium while autostart is still waiting.
- [ ] Confirm the customer kiosk appears and no unintended solenoid activates.
- [ ] Check the three services:

  ```bash
  systemctl is-active smart-vending-frontend.service
  systemctl is-active smart-vending-pi-unlock.service
  systemctl is-active smart-vending-pi-cloud-relay.service
  ```

- [ ] Check only local endpoints:

  ```bash
  curl --fail http://127.0.0.1:5173/
  curl --fail http://127.0.0.1:5000/health
  curl --fail http://127.0.0.1:5000/hardware/status
  curl --fail http://127.0.0.1:3000/health
  curl --fail http://127.0.0.1:3000/api/v1/slots
  ```

- [ ] Verify three product cards match the expected Railway configuration and
  confirm ESP32 Serial uses the installed `/dev/serial/by-id/...` path.

### Safe shutdown

- [ ] Finish or cancel the current customer/staff workflow; never power off while
  a QR is pending or a door/relay cycle is active.
- [ ] Record any paid-but-uncertain transaction for staff reconciliation.
- [ ] Notify the maintenance owner that a planned shutdown may produce an
  OFFLINE alert.
- [ ] Use the normal OS shutdown and wait for the Pi to stop before removing power:

  ```bash
  sudo systemctl poweroff
  ```

- [ ] Do not use abrupt power removal as the routine shutdown method.

### Recovery decisions

| Symptom | Safe operator response |
| --- | --- |
| Kiosk/cloud data unavailable before payment | Stop new sales; check relay/network and service status. Do not create a manual transaction. |
| ESP32 or hardware health unavailable | Stop purchase/restock actuation; inspect service/Serial status. Never guess sensor state. |
| Payment is SUCCESS but unlock result is uncertain | Preserve transaction ID, mark for staff assistance, inspect physical state and logs. **Never call `/unlock` again.** |
| Face scan fails or camera is busy | Cancel safely, allow camera release, check `/camera/status`, and retry the normal workflow. Do not overwrite a template. |
| Operational LINE delivery is missing | Do not repeat the sale/restock. Check the durable attempt/claim and logs before any reviewed retry. |
| VendingMaintenance OFFLINE arrives | Check Pi power, network, relay service, and heartbeat. A valid new heartbeat should create one RECOVERED event. |
| Product card disagrees with the cabinet | Stop sales for that slot; Railway Slot/Product configuration is business authority. Do not patch the browser locally. |

## 15. Final handover checklist

- [ ] Record repository, Railway deployment, Pi checkout, and firmware revision.
- [ ] Store the Task 61 reset transcript, backup ID, script hash, and final
  read-only reconciliation in the private evidence pack.
- [ ] Attach redacted Railway results for 3 SUCCESS transactions/THB 75,
  RestockLog, EMP001, all slots `AVAILABLE`, monitoring events, migrations, and
  report-delivery ledger.
- [ ] Attach cold-boot, purchase/unlock/audio, face-authentication/restock, refresh,
  and normal-reboot evidence.
- [ ] Attach Operational and VendingMaintenance LINE screenshots with timestamps;
  confirm Owner LINE OA is not described as receiving per-sale messages.
- [ ] Archive complete logs for backend 193/193, frontend 138/138, and Python fake
  Serial 5 tests/6 subtests with revision and runtime versions.
- [ ] Keep Production secrets out of screenshots, slides, Git, shell history, and
  handover documents. Record credential owners and rotation procedure separately.
- [ ] Record the installed Pi service environment-file locations and Serial
  `/dev/serial/by-id/...` identifier without copying secret values.
- [ ] Confirm Cloudflare human/Pi applications, Opn Test Mode account ownership,
  three LINE OA owners, and Railway backup/restore owner.
- [ ] Obtain Tech Lead signature for the T62-U03 waiver and ensure the operating
  restriction is placed beside the cabinet instructions.
- [ ] Assign an owner/date to observe the first automatic Weekly report; keep it
  PENDING until verified.
- [ ] Record Cloud Face Template Sync as deferred and document how the single Pi's
  local templates are backed up/deleted under the approved privacy procedure.
- [ ] Rehearse the 8–12 minute presentation with offline screenshots/video and a
  clear stop rule for uncertain payment or unlock outcomes.
- [ ] Obtain final Tech Lead acceptance and university handover sign-off before
  committing, deploying, or describing Task 62 as fully closed.

## 16. Likely university examiner questions

### Why use both a Raspberry Pi and an ESP32?

The Pi handles the user interface, cloud communication, face recognition, and
audio. The ESP32 provides deterministic low-level relay and sensor I/O. This
separation keeps cloud/application failures away from direct GPIO control.

### How does the system prevent a browser from declaring a fake payment success?

The browser cannot submit the amount or a success flag. Railway retrieves the
stored Opn charge with the backend secret and verifies ID, THB amount, currency,
paid status, and provider status before atomically recording `SUCCESS` and
`SOLD_OUT`.

### Is the project processing real money?

No. Final acceptance used Opn **Test Mode**. The THB 75 total is test transaction
value, not real revenue or Live Mode settlement.

### What is the source of truth for inventory?

Railway PostgreSQL `Slot.status`. IR/reed sensors help validate physical restock,
but they do not override payment or inventory business state.

### Why does payment complete before physical collection?

That is the explicit prototype business rule. Provider-confirmed payment
atomically completes the sale and marks the slot sold out. Unlock is a later
physical action; failure requires staff assistance and does not invent a refund.

### Can the same paid transaction ever unlock twice?

Normal browser recovery does not automatically resend after an uncertain
attempt, and same-process Pi duplicates are suppressed. However, an explicit
retry after Pi service restart can dispatch another `OPEN`. Therefore durable
exactly-once physical unlock is **not** guaranteed; T62-U03 remains FAIL under a
supervised-prototype waiver.

### Does an HTTP unlock success prove the lid opened?

No. It proves that Pi wrote the Serial command. The current protocol does not
durably correlate an ESP32 acknowledgement or prove solenoid/lid movement.
Physical observation and reed state are separate evidence.

### Where is biometric data stored?

Templates stay on the single Raspberry Pi. Railway stores employee records and a
safe `faceRegistered` workflow flag, not the face template. Frames, embeddings,
crops, and landmarks are not sent to the cloud.

### Is the head-turn challenge production-grade liveness detection?

No. It is a practical prototype control against a motionless presentation. It is
not certified presentation-attack detection and may not resist sophisticated
video, 3-D, or responsive replay attacks.

### What happens when the Pi loses cloud connectivity?

New cloud-dependent purchases and staff sessions cannot proceed safely. The
heartbeat state machine creates one OFFLINE event after the confirmation window;
a valid newer heartbeat creates one RECOVERED event. It does not monitor every
hardware component.

### Why are there three LINE Official Accounts?

They separate audiences and credentials: Operational for sale/restock events,
Owner for scheduled Daily/Weekly reports, and VendingMaintenance for Pi
OFFLINE/RECOVERED alerts. The Owner OA does not receive per-sale notifications.

### How does restock authorization work?

The Staff portal creates a short-lived session. Pi matches the face locally, then
Railway independently verifies the active employee and session. Restock commits
only after the all-slot physical readiness gate and records a `RestockLog`.

### What survives a normal reboot?

systemd restores the Pi services, Chromium autostarts after frontend readiness,
and Railway preserves business state. Final cold-boot/reboot acceptance passed.
Process-local caches such as unlock deduplication and face lockout do not provide
durability across service restart.

### What automated evidence supports the project?

The supplied final logs report backend 193/193, frontend 138/138, and Python fake
Serial 5 tests with 6 subtests passing. These complement—but do not replace—the
physical cabinet and Railway reconciliation evidence.

### What is still pending?

The first verified automatic Weekly report, Cloud Face Template Sync, and the
production-hardening items listed above. None is presented as completed.

### What changes would be required for unattended production?

A durable backend fulfillment claim, correlated ESP32 acknowledgement protocol,
application RBAC, certified biometric PAD or another staff credential, Live Mode
payment/financial controls, automatic incident/refund policy, multi-cabinet
identity, backup-restore drills, stronger observability, and formal security and
hardware certification.

## 17. Presentation asset gaps

The following evidence is confirmed but was not found as a presentation-ready,
redacted artifact inside the repository. Attach it from the private acceptance
evidence pack before the university presentation:

- cold-boot video with kiosk startup and no unintended actuation;
- one clear kiosk screenshot showing all three products/availability;
- privacy-safe EMP001 enrollment/authentication evidence;
- redacted Opn Test Mode charge/webhook evidence for Slots 1–3;
- synchronized correct-slot unlock and Thai-audio video;
- Operational LINE sale/inventory and restock cards;
- VendingMaintenance OFFLINE/RECOVERED cards with timestamps;
- redacted Railway query showing 3 SUCCESS transactions/THB 75, EMP001,
  RestockLog transition, three `AVAILABLE` slots, alert ledger, report ledger, and
  migration count;
- complete backend/frontend/Python test logs with revision/runtime versions;
- signed U03 waiver; and
- a cabinet overview photo plus a simple labeled hardware photo.

Do not place secrets, QR payloads, biometric images/templates, access tokens,
private database URLs, or full webhook bodies in the slide deck.
