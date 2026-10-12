# Task 56 — final power loss and reboot acceptance

**Status:** Final acceptance execution complete, 12 October 2026. The Tech Lead has reviewed and approved the physical acceptance results. Of the 12 acceptance cases, 11 passed and one failed: 56-F.3 restart-safe deduplication.

This document records the final results for the local Smart Vending Machine IoT prototype. It does not claim Cloud operation, production-grade exactly-once dispensing, or capabilities beyond the tested scope.

## Final acceptance summary

| ID | Acceptance case | Final result | Closeout note |
| --- | --- | --- | --- |
| 56-A | Pi graceful reboot | **PASS** | Pi startup, required services, kiosk UI, hardware connection, and safe idle behavior recovered after a graceful reboot. |
| 56-B.1 | ESP32 EN reset | **PASS** | The ESP32 reset safely and returned to service without unintended actuation. |
| 56-B.2 | USB Serial auto-reconnect | **PASS after Phase 1 fix** | Automatic Serial recovery passed after the Phase 1 reconnect fix. |
| 56-B.3 | Manual Serial recovery | **PASS** | The approved manual recovery path restored Serial service. |
| 56-C | IR/Reed hardware sensors | **PASS** | Physical IR and reed observations matched the reported state for all three slots. |
| 56-D.1 | Backend restart | **PASS** | The system recovered from the controlled backend restart. |
| 56-D.2 | PostgreSQL restart | **PASS** | The system recovered from the controlled PostgreSQL restart without unintended data or inventory changes. |
| 56-E | Network disconnect/reconnect | **PASS** | Pi-to-PC connectivity and normal application communication recovered after reconnection. |
| 56-F.1 | Pending payment recovery | **PASS within the tested scope** | The tested pending-payment recovery flow resumed safely within the scenarios exercised. This is not a broader exactly-once fulfillment claim. |
| 56-F.2 | Failed/expired payment recovery | **PASS** | Failed and expired payments recovered without an unlock or incorrect sale completion. |
| 56-F.3 | Restart-safe deduplication | **FAIL in isolated fake-Serial testing** | Process-local deduplication passed, but an explicitly repeated request after a simulated Pi service restart sent a second fake `OPEN` command. |
| 56-G | Controlled power loss | **PASS (8/8)** | The final Raspberry Pi cold-boot retest passed all eight acceptance checks. |

The result set above is final. In particular, the successful 56-G cold-boot result does not override or relabel the isolated 56-F.3 failure.

## Acceptance observations

### 56-A — Pi graceful reboot

The Raspberry Pi graceful reboot case passed. The Pi returned to service, the frontend and Pi Hardware Service became active, the Chromium kiosk returned to the customer UI, Serial connectivity recovered, and hardware health/status endpoints returned successfully. No unintended solenoid activation or unexpected inventory or transaction change was observed.

### 56-B — ESP32 and Serial recovery

- **56-B.1 ESP32 EN reset: PASS.** The controller reset and recovered without unintended solenoid activation.
- **56-B.2 USB Serial auto-reconnect: PASS after Phase 1 fix.** The final acceptance run verified automatic reconnection after the Phase 1 Serial recovery change.
- **56-B.3 manual Serial recovery: PASS.** The manual recovery procedure remained effective.

These results establish the tested reset and reconnect behavior. They do not establish delivery acknowledgement for an unlock command or physical dispense confirmation.

### 56-C — IR/Reed hardware sensors

Physical IR and reed acceptance passed. All three slots reported readings consistent with the observed product and door states during the approved test.

### 56-D — backend and PostgreSQL restart

- **56-D.1 backend restart: PASS.** Application service recovered after the controlled restart.
- **56-D.2 PostgreSQL restart: PASS.** Database connectivity and application operation recovered after the controlled restart, with no unintended inventory or transaction changes observed.

### 56-E — network disconnect/reconnect

The controlled Pi-to-PC network disconnect/reconnect case passed. Normal communication recovered after the network was restored, without an unintended unlock or duplicate application state change.

### 56-F — payment and session recovery

- **56-F.1 pending payment recovery: PASS within the tested scope.** The tested recovery path restored and continued pending-payment handling safely. The result applies only to the exercised scenarios.
- **56-F.2 failed/expired payment recovery: PASS.** Terminal failed and expired states did not produce an unlock or incorrect fulfillment.
- **56-F.3 restart-safe deduplication: FAIL in isolated fake-Serial testing.** Same-process duplicate handling passed, but deduplication did not survive a simulated Pi service restart when the request was explicitly repeated.

The 56-F.3 test was non-actuating. It used Flask's local test client and fake Serial transport; it did not contact a physical Serial port, energize a relay, open a lid, dispense a product, or mutate live inventory.

#### 56-F.3 observed behavior

| Scenario | Result | Observation |
| --- | --- | --- |
| Same transaction and slot requested twice within one Pi service process | **PASS** | One fake `OPEN` command was sent; the duplicate response reported `ALREADY_UNLOCKED` with `deduplicated: true`. |
| Same transaction and slot explicitly requested again after simulated Pi service restart | **FAIL** | The in-memory outcome was lost and a second fake `OPEN` command was sent. |
| Persisted frontend `ATTEMPTING` state recovered after interruption | **PASS for no automatic frontend resend** | The tested normal recovery path showed staff assistance and sent no additional unlock request. |
| Persisted frontend `UNLOCKED` state recovered after interruption | **PASS for no automatic frontend resend** | The tested normal recovery path restored the success view and sent no additional unlock request. |
| Old unlock command spontaneously replayed by Pi restart | **Not observed** | No evidence established that restart alone replays an old command. The failed case required a separate, explicit repeated request. |

#### 56-F.3 known limitations

These limitations remain open and must not be interpreted as passing restart-safe deduplication:

- Same-process unlock deduplication is **PASS**.
- Deduplication across a Pi service restart is **FAIL** under an explicitly repeated request.
- The tested normal frontend recovery flow did not automatically resend unlock requests from persisted `ATTEMPTING` or `UNLOCKED` states.
- Pi `/unlock` does not independently verify backend payment authority.
- Serial write success does not prove physical dispensing or an ESP32 acknowledgement.
- No evidence established that a Pi restart spontaneously replays an old unlock command.

For this supervised prototype, durable unlock claims and ESP32 protocol v2 are deferred. The Pi Hardware Service must remain bound to localhost and must not be publicly exposed. Any uncertain unlock outcome requires staff review and reconciliation against backend payment state and the physical machine; it must not trigger an automatic retry.

### 56-G — controlled power loss

The final controlled Raspberry Pi power-loss and restoration test passed **8/8 acceptance checks**. The approved physical evidence was:

1. The Raspberry Pi booted automatically.
2. The frontend and Pi Hardware Service became active.
3. Chromium Kiosk launched and displayed the customer UI automatically.
4. ESP32 Serial reconnected successfully.
5. `/health` returned HTTP 200 with `hardware: connected`.
6. `/hardware/status` returned HTTP 200.
7. All three slots reported correct IR/Reed readings.
8. No unintended solenoid activation was observed.
9. Inventory and transaction data remained unchanged.
10. No manual Chromium or service restart was required.

The evidence items above were grouped into the eight approved acceptance checks; all eight passed. This cold-boot result establishes recovery for the tested power-loss scenario only. It does not change the 56-F.3 result or establish durable, exactly-once unlock behavior.

## Final acceptance boundaries

- Backend transaction and inventory state remain authoritative for payment and sale status.
- The hardware service's successful Serial write is not a physical dispense acknowledgement.
- A lost response, service restart during fulfillment, or any mismatch among payment, browser, Serial, and physical state is an uncertain outcome requiring staff review.
- Do not automatically repeat `/unlock` after an uncertain result.
- Keep the hardware service on localhost; do not expose it publicly.
- Durable unlock claims and an acknowledgement-capable ESP32 protocol remain deferred for the supervised prototype.

## Closeout

Task 56 acceptance execution is complete with the results recorded in the final summary table. The controlled power-loss retest passed 8/8. Restart-safe deduplication remains a documented failure in the isolated fake-Serial scenario and is an explicit operating limitation, not a passing claim.
