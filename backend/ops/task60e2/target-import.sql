\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SELECT pg_advisory_xact_lock(600002);
LOCK TABLE "Product", "Slot", "Employee", "Transaction", "RestockLog", "KioskSession"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT count(*) FROM "Product") <> 0
    OR (SELECT count(*) FROM "Slot") <> 0
    OR (SELECT count(*) FROM "Employee") <> 0
    OR (SELECT count(*) FROM "Transaction") <> 0
    OR (SELECT count(*) FROM "RestockLog") <> 0
    OR (SELECT count(*) FROM "KioskSession") <> 0 THEN
    RAISE EXCEPTION 'target_application_tables_not_empty';
  END IF;
END $$;

CREATE TEMP TABLE task60e2_product_stage (
  id integer,
  name text,
  price numeric(10, 2),
  "imageUrl" text,
  "isActive" boolean,
  "createdAt" timestamp(3),
  "updatedAt" timestamp(3)
) ON COMMIT DROP;

CREATE TEMP TABLE task60e2_slot_stage (
  id integer,
  "slotNumber" integer,
  status "SlotStatus",
  "productId" integer,
  "createdAt" timestamp(3),
  "updatedAt" timestamp(3)
) ON COMMIT DROP;

CREATE TEMP TABLE task60e2_employee_stage (
  id integer,
  name text,
  "employeeCode" text,
  "faceRegistered" boolean,
  "isActive" boolean,
  "offboardedAt" timestamp(3),
  "createdAt" timestamp(3),
  "updatedAt" timestamp(3)
) ON COMMIT DROP;

\copy task60e2_product_stage FROM '/tmp/task60e2/products.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
\copy task60e2_slot_stage FROM '/tmp/task60e2/slots.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
\copy task60e2_employee_stage FROM '/tmp/task60e2/employees.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

DO $$
BEGIN
  IF (SELECT count(*) FROM task60e2_product_stage) <> 3
    OR (SELECT count(DISTINCT id) FROM task60e2_product_stage) <> 3
    OR EXISTS (
      SELECT 1 FROM task60e2_product_stage
      WHERE id NOT IN (10, 13, 14)
        OR name IS NULL OR btrim(name) = ''
        OR price <= 0
        OR "imageUrl" IS NULL OR "imageUrl" !~ '^https://'
        OR "isActive" IS DISTINCT FROM true
        OR "createdAt" IS NULL OR "updatedAt" IS NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM task60e2_product_stage WHERE id = 14 AND name = 'doritos' AND price = 22.00
    )
    OR NOT EXISTS (
      SELECT 1 FROM task60e2_product_stage WHERE id = 13 AND name = 'Lay''s' AND price = 31.00
    )
    OR NOT EXISTS (
      SELECT 1 FROM task60e2_product_stage WHERE id = 10 AND name = 'KARAMUCHO' AND price = 25.00
    ) THEN
    RAISE EXCEPTION 'staged_product_validation_failed';
  END IF;

  IF (SELECT count(*) FROM task60e2_slot_stage) <> 3
    OR (SELECT count(DISTINCT id) FROM task60e2_slot_stage) <> 3
    OR (SELECT count(DISTINCT "slotNumber") FROM task60e2_slot_stage) <> 3
    OR EXISTS (
      SELECT 1 FROM task60e2_slot_stage
      WHERE id NOT IN (1, 2, 3)
        OR "slotNumber" NOT IN (1, 2, 3)
        OR "productId" IS NULL
        OR "createdAt" IS NULL OR "updatedAt" IS NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM task60e2_slot_stage WHERE id = 1 AND "slotNumber" = 1 AND "productId" = 14
    )
    OR NOT EXISTS (
      SELECT 1 FROM task60e2_slot_stage WHERE id = 2 AND "slotNumber" = 2 AND "productId" = 13
    )
    OR NOT EXISTS (
      SELECT 1 FROM task60e2_slot_stage WHERE id = 3 AND "slotNumber" = 3 AND "productId" = 10
    )
    OR EXISTS (
      SELECT 1 FROM task60e2_slot_stage slot
      WHERE NOT EXISTS (SELECT 1 FROM task60e2_product_stage product WHERE product.id = slot."productId")
    ) THEN
    RAISE EXCEPTION 'staged_slot_validation_failed';
  END IF;

  IF (SELECT count(*) FROM task60e2_employee_stage) <> 4
    OR (SELECT count(DISTINCT id) FROM task60e2_employee_stage) <> 4
    OR (SELECT count(DISTINCT "employeeCode") FROM task60e2_employee_stage) <> 4
    OR EXISTS (
      SELECT 1 FROM task60e2_employee_stage
      WHERE id NOT IN (1, 5, 72, 73)
        OR "employeeCode" NOT IN ('EMP001', 'EMP002', 'EMP069', 'EMP070')
        OR name IS NULL OR btrim(name) = ''
        OR "offboardedAt" IS NOT NULL
        OR "createdAt" IS NULL OR "updatedAt" IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM (VALUES
        (1, 'EMP001'), (5, 'EMP002'), (72, 'EMP069'), (73, 'EMP070')
      ) expected(id, code)
      WHERE NOT EXISTS (
        SELECT 1 FROM task60e2_employee_stage employee
        WHERE employee.id = expected.id AND employee."employeeCode" = expected.code
      )
    ) THEN
    RAISE EXCEPTION 'staged_employee_validation_failed';
  END IF;
END $$;

INSERT INTO "Product" (id, name, price, "imageUrl", "isActive", "createdAt", "updatedAt")
SELECT id, name, price, "imageUrl", "isActive", "createdAt", "updatedAt"
FROM task60e2_product_stage;

INSERT INTO "Employee" (
  id, name, "employeeCode", "faceEmbedding", "faceRegistered", "isActive",
  "offboardedAt", "createdAt", "updatedAt"
)
SELECT
  id, name, "employeeCode", NULL, "faceRegistered", "isActive",
  "offboardedAt", "createdAt", "updatedAt"
FROM task60e2_employee_stage;

INSERT INTO "Slot" (id, "slotNumber", status, "productId", "createdAt", "updatedAt")
SELECT id, "slotNumber", status, "productId", "createdAt", "updatedAt"
FROM task60e2_slot_stage;

SELECT setval(pg_get_serial_sequence('"Product"', 'id'), (SELECT max(id) FROM "Product"), true);
SELECT setval(pg_get_serial_sequence('"Slot"', 'id'), (SELECT max(id) FROM "Slot"), true);
SELECT setval(pg_get_serial_sequence('"Employee"', 'id'), (SELECT max(id) FROM "Employee"), true);
SELECT setval(
  '"EmployeeCodeNumber_seq"',
  (SELECT max(substring("employeeCode" FROM 4)::bigint) + 1 FROM "Employee"),
  false
);

DO $$
BEGIN
  IF (SELECT count(*) FROM "Product") <> 3
    OR (SELECT count(*) FROM "Slot") <> 3
    OR (SELECT count(*) FROM "Employee") <> 4
    OR (SELECT count(*) FROM "Transaction") <> 0
    OR (SELECT count(*) FROM "RestockLog") <> 0
    OR (SELECT count(*) FROM "KioskSession") <> 0
    OR EXISTS (SELECT 1 FROM "Employee" WHERE "faceEmbedding" IS NOT NULL) THEN
    RAISE EXCEPTION 'post_insert_validation_failed';
  END IF;
END $$;

COMMIT;
