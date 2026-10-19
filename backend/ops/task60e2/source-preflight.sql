\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  expected_migrations CONSTANT text[] := ARRAY[
    '20260824041816_init',
    '20260824045543_refine_schema',
    '20260922145000_add_employee_face_registered',
    '20260923090000_add_opn_payment_reconciliation',
    '20260923093000_align_seed_prices_with_promptpay_limits',
    '20260924090000_add_notification_attempt_claims',
    '20260928090000_add_kiosk_sessions',
    '20260929090000_add_employee_code_sequence',
    '20260929140000_add_employee_cleanup_sessions',
    '20260929140100_bind_employee_cleanup_sessions',
    '20261006090000_add_employee_offboarded_at',
    '20261007090000_add_transaction_customer_cancellation'
  ];
  required_columns CONSTANT text[][] := ARRAY[
    ARRAY['Product', 'id'], ARRAY['Product', 'name'], ARRAY['Product', 'price'],
    ARRAY['Product', 'imageUrl'], ARRAY['Product', 'isActive'],
    ARRAY['Product', 'createdAt'], ARRAY['Product', 'updatedAt'],
    ARRAY['Slot', 'id'], ARRAY['Slot', 'slotNumber'], ARRAY['Slot', 'status'],
    ARRAY['Slot', 'productId'], ARRAY['Slot', 'createdAt'], ARRAY['Slot', 'updatedAt'],
    ARRAY['Employee', 'id'], ARRAY['Employee', 'name'], ARRAY['Employee', 'employeeCode'],
    ARRAY['Employee', 'faceEmbedding'], ARRAY['Employee', 'faceRegistered'],
    ARRAY['Employee', 'isActive'], ARRAY['Employee', 'offboardedAt'],
    ARRAY['Employee', 'createdAt'], ARRAY['Employee', 'updatedAt']
  ];
  column_pair text[];
BEGIN
  IF to_regclass('public."Product"') IS NULL
    OR to_regclass('public."Slot"') IS NULL
    OR to_regclass('public."Employee"') IS NULL
    OR to_regclass('public."Transaction"') IS NULL
    OR to_regclass('public."RestockLog"') IS NULL
    OR to_regclass('public."KioskSession"') IS NULL THEN
    RAISE EXCEPTION 'source_schema_mismatch';
  END IF;

  FOREACH column_pair SLICE 1 IN ARRAY required_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = column_pair[1]
        AND column_name = column_pair[2]
    ) THEN
      RAISE EXCEPTION 'source_schema_mismatch';
    END IF;
  END LOOP;

  IF to_regclass('public."EmployeeCodeNumber_seq"') IS NULL
    OR pg_get_serial_sequence('"Product"', 'id') IS NULL
    OR pg_get_serial_sequence('"Slot"', 'id') IS NULL
    OR pg_get_serial_sequence('"Employee"', 'id') IS NULL THEN
    RAISE EXCEPTION 'source_sequence_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(expected_migrations) AS expected(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM "_prisma_migrations" applied
      WHERE applied.migration_name = expected.name
        AND applied.finished_at IS NOT NULL
        AND applied.rolled_back_at IS NULL
    )
  ) OR EXISTS (
    SELECT 1 FROM "_prisma_migrations" applied
    WHERE applied.finished_at IS NOT NULL
      AND applied.rolled_back_at IS NULL
      AND NOT (applied.migration_name = ANY(expected_migrations))
  ) THEN
    RAISE EXCEPTION 'source_migration_history_mismatch';
  END IF;

  IF (SELECT count(*) FROM "Slot" WHERE "slotNumber" IN (1, 2, 3)) <> 3
    OR EXISTS (SELECT 1 FROM "Slot" WHERE "slotNumber" IN (1, 2, 3) AND "productId" IS NULL)
    OR (
      SELECT count(DISTINCT "productId") FROM "Slot" WHERE "slotNumber" IN (1, 2, 3)
    ) <> 3 THEN
    RAISE EXCEPTION 'source_slot_set_mismatch';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Slot" WHERE id = 1 AND "slotNumber" = 1 AND "productId" = 14)
    OR NOT EXISTS (SELECT 1 FROM "Slot" WHERE id = 2 AND "slotNumber" = 2 AND "productId" = 13)
    OR NOT EXISTS (SELECT 1 FROM "Slot" WHERE id = 3 AND "slotNumber" = 3 AND "productId" = 10) THEN
    RAISE EXCEPTION 'source_slot_identity_or_relationship_mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Product"
    WHERE id = 14 AND name = 'doritos' AND price = 22.00 AND "isActive" = true
  ) OR NOT EXISTS (
    SELECT 1 FROM "Product"
    WHERE id = 13 AND name = 'Lay''s' AND price = 31.00 AND "isActive" = true
  ) OR NOT EXISTS (
    SELECT 1 FROM "Product"
    WHERE id = 10 AND name = 'KARAMUCHO' AND price = 25.00 AND "isActive" = true
  ) THEN
    RAISE EXCEPTION 'source_product_identity_or_value_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Product" p
    JOIN "Slot" s ON s."productId" = p.id
    WHERE s."slotNumber" IN (1, 2, 3)
      AND (p."imageUrl" IS NULL OR p."imageUrl" !~ '^https://')
  ) THEN
    RAISE EXCEPTION 'source_product_image_mismatch';
  END IF;

  IF (SELECT count(*) FROM "Employee" WHERE "offboardedAt" IS NULL) <> 4
    OR EXISTS (
      SELECT 1 FROM (VALUES
        (1, 'EMP001'), (5, 'EMP002'), (72, 'EMP069'), (73, 'EMP070')
      ) expected(id, code)
      WHERE NOT EXISTS (
        SELECT 1 FROM "Employee" employee
        WHERE employee.id = expected.id
          AND employee."employeeCode" = expected.code
          AND employee."offboardedAt" IS NULL
      )
    ) THEN
    RAISE EXCEPTION 'source_employee_set_mismatch';
  END IF;
END $$;

SELECT
  (SELECT count(DISTINCT p.id)
   FROM "Product" p JOIN "Slot" s ON s."productId" = p.id
   WHERE s."slotNumber" IN (1, 2, 3)) AS products_to_export,
  (SELECT count(*) FROM "Slot" WHERE "slotNumber" IN (1, 2, 3)) AS slots_to_export,
  (SELECT count(*) FROM "Employee" WHERE "offboardedAt" IS NULL) AS employees_to_export;

ROLLBACK;
