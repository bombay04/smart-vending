# Task 61 one-time demo-data reset

Status: **prepared and rehearsed only; Production execution is not authorized.**

`reset-demo-data.sql` is an operator-only `psql` script. It is not referenced by
application startup, package scripts, Prisma migrations, deployment commands, or
scheduled jobs.

The script deletes only:

- `Transaction`
- `RestockLog`
- `KioskSession`
- `Employee`

It transactionally restarts only `EmployeeCodeNumber_seq`. It does not use
`TRUNCATE`, does not reset primary-key sequences, and hashes the reviewed
preserved tables before and after the deletes. Reviewed row counts and foreign
keys are intentionally hard-coded; any Production drift requires a fresh backup,
another isolated rehearsal, and renewed Tech Lead approval rather than editing
values during a maintenance window.

## Mandatory external gates

The operator must independently verify every gate before supplying it as `on`:

- `execution_authorized`: explicit Tech Lead authorization for that exact target,
  script hash, backup, and maintenance window.
- `pi_templates_empty`: filename-only Pi inventory confirms no face templates.
- `business_writes_quiesced`: purchases, restocks, kiosk sessions, and employee
  administration cannot reach the backend.
- `payment_webhooks_quiesced`: Opn callbacks cannot be processed during the reset.

The SQL cannot inspect the Pi or upstream HTTP traffic. These flags are deliberate
operator assertions, not automatic checks. Missing or false flags raise a database
error before the reset transaction starts.

The reviewed command shape is:

```text
psql -X --set=ON_ERROR_STOP=on \
  --set=execution_authorized=on \
  --set=pi_templates_empty=on \
  --set=business_writes_quiesced=on \
  --set=payment_webhooks_quiesced=on \
  --file reset-demo-data.sql
```

Do not run that command against Production until the Tech Lead separately approves
execution. Do not place a database URL or password in the command line or this
directory.

## Rehearsal-only helpers

The other SQL files in this directory are for isolated disposable databases only:

- `rehearsal-inventory.sql` records before/after counts and sequence state.
- `rehearsal-post-reset-verify.sql` checks FK validation, slot relationships,
  machine state, and employee-code sequence state.
- `rehearsal-allocate-employee-code.sql` consumes a sequence value to prove the
  next allocation is 1; `rehearsal-restart-employee-code.sql` restores the
  disposable database to the expected final sequence state.
- `rehearsal-inject-*` files deliberately add unsafe isolated state to prove the
  reset refuses active sessions, unexpired payments, and unexpected foreign keys.

Never run a `rehearsal-inject-*` file against Production.
