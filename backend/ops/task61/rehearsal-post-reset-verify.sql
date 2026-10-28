\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET CONSTRAINTS ALL IMMEDIATE;

SELECT 'INVALID_FOREIGN_KEYS', count(*)
FROM pg_constraint
WHERE contype = 'f' AND NOT convalidated;

SELECT 'SLOT_PRODUCT_ORPHANS', count(*)
FROM "Slot" AS slot_row
LEFT JOIN "Product" AS product_row ON product_row.id = slot_row."productId"
WHERE slot_row."productId" IS NOT NULL AND product_row.id IS NULL;

SELECT 'MACHINE_STATE', "machineId", connectivity::text
FROM "HardwareMachine"
ORDER BY "machineId";

SELECT 'EMPLOYEE_CODE_SEQUENCE', last_value, is_called
FROM "EmployeeCodeNumber_seq";

COMMIT;
