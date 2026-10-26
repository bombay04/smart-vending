# Phase 3 Offline-Only Monitoring

## Scope and safety boundary

Phase 3 monitors only whether the existing Pi Cloud Relay is reaching the Cloud API.
The relay sends one authenticated heartbeat every 60 seconds from its own daemon thread.
It does not call the Pi Unlock Service, /hardware/status, or /monitoring/snapshot; it
does not import or open a Serial port; and it does not depend on Chromium. No ESP32,
IR, Reed, solenoid, or unlock-fault monitoring is present.

The implementation does not write Product, Slot, Transaction, Employee, RestockLog,
KioskSession, payment, unlock, restock, face-recognition, or firmware state. The
existing Pi Unlock Service remains the only owner of the ESP32 Serial connection.

## Authentication and machine binding

The relay sends its existing Cloudflare Access service-token ID and secret only to the
fixed HTTPS Pi API origin. Cloudflare validates the service token and inserts the signed
Cf-Access-Jwt-Assertion. The backend verifies the JWT signature, issuer, audience,
time claims, application-token type, and common_name.

PI_MACHINE_BINDINGS_JSON maps that verified common_name to the expected machine ID.
The heartbeat body cannot select another machine: the controller compares its
machineId with the authenticated binding. Missing, invalid, expired, unenrolled, or
mismatched credentials fail closed. Staff/admin application credentials do not bypass
this machine-token route.

Give each future cabinet a distinct Cloudflare Access service token and binding. Never
copy the pilot credential to another cabinet.

## Heartbeat and offline state machine

POST /api/v1/hardware/heartbeat accepts only:

~~~json
{
  "version": 1,
  "machineId": "PILOT_KIOSK",
  "sequence": 123,
  "observedAt": "2026-10-26T12:00:00.000Z"
}
~~~

The server receive time is the authoritative last-seen value. The Pi timestamp and
monotonic sequence reject duplicate or out-of-order submissions but do not decide
online/offline state.

The first authenticated heartbeat enrolls the machine as ONLINE; there is no row and
no alert before enrollment. A stale machine goes through two durable stages:

1. After five minutes without a server-received heartbeat, an evaluator records an
   offline candidate without alerting.
2. A later evaluator, after another five minutes of continuous evaluator operation and
   continued heartbeat absence, atomically changes ONLINE to OFFLINE and creates one
   OFFLINE event.

If the evaluator has not run recently (for example during a Cloud outage), its next run
restarts confirmation instead of immediately alerting from old data. This prevents
false alerts after Cloud recovery while ensuring a genuinely offline machine is
eventually detected once scheduled evaluation is continuously available. A RECOVERED
event can be created only by a newer authenticated heartbeat while the machine is
OFFLINE.

Serializable transactions and compare-and-set updates make concurrent heartbeat and
evaluator runs converge on one transition. One continuous outage can therefore create
only one OFFLINE event and one later RECOVERED event.

## LINE delivery

Hardware alerts reuse the existing tested LINE Broadcast transport but construct it
with the dedicated VendingMaintenance channel token. They never read or fall back to
the SmartVendingOwner token. Daily/Weekly owner reports and employee notifications
remain unchanged. The transition transaction persists an immutable serialized payload,
a random retry key, and the key creation time before any network send.

Delivery uses that exact stored payload and X-Line-Retry-Key for every attempt. HTTP
200 is accepted. HTTP 409 is accepted only when LINE returns
x-line-accepted-request-id. Network errors, 408, 429, and 5xx responses are retryable;
other responses go to MANUAL_REVIEW. Retry keys expire after 24 hours, and stale
SENDING claims count toward the five-attempt cap. Expired, exhausted, and non-retryable
deliveries enter durable MANUAL_REVIEW and are not sent automatically again.

Implementation and tests must not invoke real LINE delivery. The scheduled evaluator
command creates durable events and then processes their bounded delivery claims; no
scheduler is created during implementation review.

## Migration safety

20261026130000_add_hardware_monitoring is an additive, not-yet-deployed PostgreSQL
migration wrapped in explicit BEGIN and COMMIT. It creates only HardwareMachine and
HardwareAlertEvent, their enums, indexes, and foreign keys. It does not retain an
unbounded row per minute; the latest sequence, observation time, and server receive
time are held on HardwareMachine. It does not alter existing business or reporting
tables, so applying it before the Pi upgrade does not change existing service behavior.

The migration creates a unique alert retry-key index plus evaluator and delivery
lookup indexes. New-table index creation takes no locks on existing business tables
beyond catalog work. Previously applied migrations are untouched.

Rehearse against a fresh, isolated restore of current production data before approval.
A Phase 2 backup that predates later required schema changes is not a valid
production-copy rehearsal.

## Required configuration

Railway backend:

~~~text
PI_MACHINE_BINDINGS_JSON={"<existing Pi service-token client ID>":"PILOT_KIOSK"}
LINE_MAINTENANCE_CHANNEL_ACCESS_TOKEN=<VendingMaintenance channel access token>
~~~

Do not put the service-token secret in Railway. Keep the existing Cloudflare Access
issuer, audience, and expected service-token client-ID settings unchanged. After
separate Tech Lead approval, a scheduler must run npm run hardware:evaluate about
every five minutes. Do not create it during implementation review.

LINE_OWNER_CHANNEL_ACCESS_TOKEN remains the independent Phase 2 Daily/Weekly report
credential. LINE_CHANNEL_ACCESS_TOKEN remains the independent employee-notification
credential. Neither is a fallback for Phase 3.

Pi /etc/smart-vending/pi-cloud-relay.env:

~~~text
KIOSK_MACHINE_ID=PILOT_KIOSK
HARDWARE_HEARTBEAT_INTERVAL_SECONDS=60
CF_ACCESS_CLIENT_ID=<existing machine service-token client ID>
CF_ACCESS_CLIENT_SECRET=<existing machine service-token secret>
~~~

Keep the existing fixed PI_CLOUD_UPSTREAM_ORIGIN and timeout settings. No new Pi
process and no Pi Unlock Service configuration change are required.

## Deployment and Physical Acceptance plan

Do not deploy before Tech Lead approval.

1. Take a fresh production backup and restore it into an isolated database.
2. Apply the pending migration to the isolated restore and run backend regression tests.
3. Apply the migration and backend release before upgrading the Pi.
4. Configure the Railway machine binding, then separately review and create the
   five-minute evaluator schedule.
5. Update and restart only the existing Pi Cloud Relay service; leave the unlock
   service, frontend, firmware, and Chromium configuration unchanged.
6. With Chromium and the Pi Unlock Service stopped, confirm the relay still records
   three 60-second heartbeats and no alert.
7. Stop the relay/network. Confirm the first stale evaluation only starts confirmation,
   the later continuous evaluation creates one OFFLINE event, and repeated runs create
   no additional events or messages.
8. Restore the relay and confirm one authenticated heartbeat creates one RECOVERED
   event. An unreadable/malformed heartbeat must not recover the machine.
9. Simulate evaluator/Cloud downtime longer than the thresholds, restore the Cloud
   while the Pi remains offline, and confirm the confirmation window restarts.
10. Use a stub LINE provider to verify maintenance-token isolation, missing-token
    failure, 200, accepted 409, retryable failures, non-retryable failures, stale
    claims, attempt exhaustion, and 24-hour expiry.
11. Run payment, unlock, face recognition, restock, Daily/Weekly report, and employee
    notification acceptance checks.

Physical Acceptance remains necessary for Pi boot/network behavior, systemd restart
behavior, actual Cloudflare token policy, actual scheduler timing, LINE delivery to the
VendingMaintenance account, and end-to-end outage/recovery timing. LINE API acceptance
cannot prove that a technician read the message.
