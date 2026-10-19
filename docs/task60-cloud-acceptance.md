# Task 60 Cloud Functional Acceptance

Acceptance status: **PASS / CLOSED**
Recorded: 2026-10-19

This document records the results observed during the operator's completed Task
60 functional acceptance. It does not extend the result to scenarios listed as
untested under Known limitations.

## Cloud infrastructure — PASS

- Railway Backend and PostgreSQL deployed successfully.
- Cloudflare Tunnel and Access were operational.
- Raspberry Pi Cloud Relay was operational.
- The Pi initiated requests to the cloud; the cloud did not directly connect to
  the Pi.

## Data migration — PASS

- Migrated 3 Products, 3 Slots, and 4 Employees.
- Preserved the current product names, prices, images, IDs, and slot assignments.
- The transactional import committed successfully.
- Post-import verification passed.
- The Pi Relay retrieved the migrated products from Railway.
- A pre-import logical backup was saved on the operator PC and its SHA-256 was
  verified.

## Cloud payment end-to-end — PASS

- The local PC Backend was stopped for the test.
- The kiosk generated a PromptPay QR using Opn Test Mode.
- Payment and cloud webhook processing succeeded.
- The correct physical slot unlocked.
- The kiosk displayed Success.
- LINE notification and Thai audio worked.

## Staff/Admin cloud workflow — PASS

- `/staff` and `/admin` were accessible through HTTPS.
- Staff started a Restock Session in the cloud.
- Pi polling detected the session and displayed Face Scan.
- Existing employee Face Recognition succeeded.
- Restock completed and Slot 1 returned to `AVAILABLE`.
- Admin updated a product price in Railway and the Pi displayed the updated
  price.
- The operator tested the complete new-employee face-registration workflow and
  it worked correctly.

## Known limitations

- Local and Railway databases are not automatically synchronized.
- Database backup integrity was checked, but restoration was not tested.
- Cloud and network outage scenarios were not comprehensively tested.
- No untested scenario is represented as having passed.

## Conclusion

**Task 60 Functional Acceptance PASS / CLOSED.**
