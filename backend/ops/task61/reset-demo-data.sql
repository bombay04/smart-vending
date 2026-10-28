\set ON_ERROR_STOP on

-- Task 61: reviewed, one-time selective demo-data reset.
--
-- This file is intentionally not a Prisma migration or application command.
-- It must be run with psql and every external gate explicitly set to `on`:
--
--   --set=execution_authorized=on
--   --set=pi_templates_empty=on
--   --set=business_writes_quiesced=on
--   --set=payment_webhooks_quiesced=on
--
-- SQL cannot inspect the Raspberry Pi filesystem. `pi_templates_empty` is an
-- operator assertion backed by a filename-only Pi inventory reviewed before
-- execution. Setting a gate for an isolated rehearsal does not authorize a
-- Production reset.

\if :{?execution_authorized}
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: execution_authorized was not supplied.';
  END $task61_gate$;
\endif
\if :execution_authorized
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: execution_authorized must be on.';
  END $task61_gate$;
\endif

\if :{?pi_templates_empty}
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: pi_templates_empty was not supplied.';
  END $task61_gate$;
\endif
\if :pi_templates_empty
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: Pi template inventory is not approved empty.';
  END $task61_gate$;
\endif

\if :{?business_writes_quiesced}
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: business_writes_quiesced was not supplied.';
  END $task61_gate$;
\endif
\if :business_writes_quiesced
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: business writes are not confirmed quiesced.';
  END $task61_gate$;
\endif

\if :{?payment_webhooks_quiesced}
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: payment_webhooks_quiesced was not supplied.';
  END $task61_gate$;
\endif
\if :payment_webhooks_quiesced
\else
  DO $task61_gate$ BEGIN
    RAISE EXCEPTION 'TASK61 REFUSED: payment webhooks are not confirmed quiesced.';
  END $task61_gate$;
\endif

\if :{?rehearsal_force_failure}
\else
  \set rehearsal_force_failure off
\endif

BEGIN ISOLATION LEVEL SERIALIZABLE;

-- Fail instead of waiting behind unexpected live traffic. The eventual
-- Production window must quiesce business writers before this transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Block writes only to the approved reset tables. Hardware heartbeat and
-- monitoring tables are deliberately not locked.
LOCK TABLE
  "Transaction",
  "RestockLog",
  "KioskSession",
  "Employee"
IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE task61_expected_foreign_keys (
  constraint_name text PRIMARY KEY,
  child_table text NOT NULL,
  parent_table text NOT NULL
) ON COMMIT DROP;

INSERT INTO task61_expected_foreign_keys
  (constraint_name, child_table, parent_table)
VALUES
  ('KioskSession_employeeId_fkey', 'KioskSession', 'Employee'),
  ('RestockLog_employeeId_fkey', 'RestockLog', 'Employee'),
  ('Transaction_productId_fkey', 'Transaction', 'Product'),
  ('Transaction_slotId_fkey', 'Transaction', 'Slot');

DO $task61$
DECLARE
  mismatch_count integer;
BEGIN
  WITH actual AS (
    SELECT
      constraint_row.conname::text AS constraint_name,
      child.relname::text AS child_table,
      parent.relname::text AS parent_table
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS child ON child.oid = constraint_row.conrelid
    JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent.relnamespace
    WHERE constraint_row.contype = 'f'
      AND child_namespace.nspname = current_schema()
      AND parent_namespace.nspname = current_schema()
      AND (
        child.relname IN ('Transaction', 'RestockLog', 'KioskSession', 'Employee')
        OR parent.relname IN ('Transaction', 'RestockLog', 'KioskSession', 'Employee')
      )
  ), differences AS (
    (SELECT * FROM actual EXCEPT SELECT * FROM task61_expected_foreign_keys)
    UNION ALL
    (SELECT * FROM task61_expected_foreign_keys EXCEPT SELECT * FROM actual)
  )
  SELECT count(*) INTO mismatch_count FROM differences;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: reset-table foreign-key dependencies differ from the reviewed set.';
  END IF;
END
$task61$;

DO $task61$
BEGIN
  IF (SELECT count(*) FROM "Product") <> 12 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 12 Product rows.';
  END IF;
  IF (SELECT count(*) FROM "Slot") <> 3 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 3 Slot rows.';
  END IF;
  IF (SELECT count(*) FROM "SalesReportDelivery") <> 3 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 3 SalesReportDelivery rows.';
  END IF;
  IF (SELECT count(*) FROM "HardwareMachine") <> 1 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 1 HardwareMachine row.';
  END IF;
  IF (SELECT count(*) FROM "HardwareAlertEvent") <> 6 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 6 HardwareAlertEvent rows.';
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations) <> 15 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 15 Prisma migration rows.';
  END IF;

  IF (SELECT count(*) FROM "Transaction") <> 34 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 34 Transaction rows.';
  END IF;
  IF (SELECT count(*) FROM "RestockLog") <> 15 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 15 RestockLog rows.';
  END IF;
  IF (SELECT count(*) FROM "KioskSession") <> 155 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 155 KioskSession rows.';
  END IF;
  IF (SELECT count(*) FROM "Employee") <> 10 THEN
    RAISE EXCEPTION 'TASK61 REFUSED: expected 10 Employee rows.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "KioskSession"
    WHERE status = 'ACTIVE' AND "expiresAt" > transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: an active KioskSession remains.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "KioskSession"
    WHERE type = 'EMPLOYEE_OFFBOARDING'
      AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: an offboarding session is not terminal.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Transaction"
    WHERE "paymentStatus" = 'PENDING'
      AND "customerCancelledAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > transaction_timestamp())
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: an unexpired pending payment remains.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Transaction"
    WHERE "paymentStatus" = 'SUCCESS'
      AND "updatedAt" > transaction_timestamp() - interval '5 minutes'
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: a recently completed payment may still be fulfilling.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Transaction"
    WHERE "paymentStatus" = 'SUCCESS'
      AND "customerCancelledAt" IS NULL
      AND "saleNotificationAttemptedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: a successful sale has no notification-attempt claim.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Employee"
    WHERE "isActive" OR "faceRegistered" OR "offboardedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: every Employee must be fully offboarded first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "HardwareMachine"
    WHERE "machineId" = 'PILOT_KIOSK' AND connectivity = 'ONLINE'
  ) THEN
    RAISE EXCEPTION 'TASK61 REFUSED: PILOT_KIOSK is not registered ONLINE.';
  END IF;

  IF to_regclass('"EmployeeCodeNumber_seq"') IS NULL THEN
    RAISE EXCEPTION 'TASK61 REFUSED: EmployeeCodeNumber_seq is missing.';
  END IF;
END
$task61$;

CREATE TEMP TABLE task61_preserved_baseline (
  object_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_hash text NOT NULL
) ON COMMIT DROP;

INSERT INTO task61_preserved_baseline (object_name, row_count, row_hash)
SELECT 'Product', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
FROM "Product" AS source_row
UNION ALL
SELECT 'Slot', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
FROM "Slot" AS source_row
UNION ALL
SELECT 'SalesReportDelivery', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
FROM "SalesReportDelivery" AS source_row
UNION ALL
SELECT 'HardwareMachine', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row."machineId"), ''))
FROM "HardwareMachine" AS source_row
UNION ALL
SELECT 'HardwareAlertEvent', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
FROM "HardwareAlertEvent" AS source_row
UNION ALL
SELECT '_prisma_migrations', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
FROM _prisma_migrations AS source_row;

CREATE TEMP TABLE task61_sequence_baseline AS
SELECT sequencename, last_value
FROM pg_sequences
WHERE schemaname = current_schema()
  AND sequencename <> 'EmployeeCodeNumber_seq';

DELETE FROM "Transaction";
DELETE FROM "RestockLog";
DELETE FROM "KioskSession";
DELETE FROM "Employee";

ALTER SEQUENCE "EmployeeCodeNumber_seq" RESTART WITH 1;

DO $task61$
DECLARE
  preserved_mismatch_count integer;
  sequence_mismatch_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "Transaction")
    OR EXISTS (SELECT 1 FROM "RestockLog")
    OR EXISTS (SELECT 1 FROM "KioskSession")
    OR EXISTS (SELECT 1 FROM "Employee") THEN
    RAISE EXCEPTION 'TASK61 FAILED: at least one reset table is not empty.';
  END IF;

  WITH current_preserved AS (
    SELECT 'Product' object_name, count(*) row_count,
      md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), '')) row_hash
    FROM "Product" AS source_row
    UNION ALL
    SELECT 'Slot', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
    FROM "Slot" AS source_row
    UNION ALL
    SELECT 'SalesReportDelivery', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
    FROM "SalesReportDelivery" AS source_row
    UNION ALL
    SELECT 'HardwareMachine', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row."machineId"), ''))
    FROM "HardwareMachine" AS source_row
    UNION ALL
    SELECT 'HardwareAlertEvent', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
    FROM "HardwareAlertEvent" AS source_row
    UNION ALL
    SELECT '_prisma_migrations', count(*), md5(COALESCE(string_agg(to_jsonb(source_row)::text, '' ORDER BY source_row.id), ''))
    FROM _prisma_migrations AS source_row
  ), differences AS (
    (SELECT * FROM current_preserved EXCEPT SELECT * FROM task61_preserved_baseline)
    UNION ALL
    (SELECT * FROM task61_preserved_baseline EXCEPT SELECT * FROM current_preserved)
  )
  SELECT count(*) INTO preserved_mismatch_count FROM differences;

  IF preserved_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'TASK61 FAILED: a preserved table changed.';
  END IF;

  WITH current_sequences AS (
    SELECT sequencename, last_value
    FROM pg_sequences
    WHERE schemaname = current_schema()
      AND sequencename <> 'EmployeeCodeNumber_seq'
  ), differences AS (
    (SELECT * FROM current_sequences EXCEPT SELECT * FROM task61_sequence_baseline)
    UNION ALL
    (SELECT * FROM task61_sequence_baseline EXCEPT SELECT * FROM current_sequences)
  )
  SELECT count(*) INTO sequence_mismatch_count FROM differences;

  IF sequence_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'TASK61 FAILED: an unrelated sequence changed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "EmployeeCodeNumber_seq"
    WHERE last_value = 1 AND is_called = false
  ) THEN
    RAISE EXCEPTION 'TASK61 FAILED: EmployeeCodeNumber_seq is not ready for EMP001.';
  END IF;
END
$task61$;

\if :rehearsal_force_failure
  DO $task61$
  BEGIN
    RAISE EXCEPTION 'TASK61 INTENTIONAL REHEARSAL FAILURE: transaction must roll back.';
  END
  $task61$;
\endif

COMMIT;

SELECT 'TASK61 RESET COMMITTED' AS result;
