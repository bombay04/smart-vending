\set ON_ERROR_STOP on
\pset pager off

BEGIN TRANSACTION READ ONLY;

SELECT
  s.id,
  s."slotNumber",
  s.status,
  s."productId",
  p.name,
  p.price,
  p."isActive",
  (p."imageUrl" IS NOT NULL AND p."imageUrl" ~ '^https://') AS has_https_image
FROM "Slot" s
JOIN "Product" p ON p.id = s."productId"
ORDER BY s."slotNumber";

SELECT
  id,
  "employeeCode",
  "isActive",
  "faceRegistered",
  (name IS NOT NULL AND btrim(name) <> '') AS has_name,
  ("offboardedAt" IS NULL) AS current_employee,
  ("faceEmbedding" IS NULL) AS biometric_column_empty
FROM "Employee"
ORDER BY "employeeCode";

SELECT
  (SELECT count(*) FROM "Product") AS products,
  (SELECT count(*) FROM "Slot") AS slots,
  (SELECT count(*) FROM "Employee") AS employees,
  (SELECT count(*) FROM "Transaction") AS transactions,
  (SELECT count(*) FROM "RestockLog") AS restocks,
  (SELECT count(*) FROM "KioskSession") AS sessions,
  (SELECT last_value FROM "Product_id_seq") AS product_sequence,
  (SELECT last_value FROM "Slot_id_seq") AS slot_sequence,
  (SELECT last_value FROM "Employee_id_seq") AS employee_sequence,
  (SELECT last_value FROM "EmployeeCodeNumber_seq") AS employee_code_sequence;

ROLLBACK;
