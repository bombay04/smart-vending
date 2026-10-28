\set ON_ERROR_STOP on

BEGIN READ ONLY;

SELECT 'COUNT', inventory.table_name, inventory.row_count
FROM (
  SELECT 'Product' AS table_name, count(*) AS row_count FROM "Product"
  UNION ALL SELECT 'Slot', count(*) FROM "Slot"
  UNION ALL SELECT 'Transaction', count(*) FROM "Transaction"
  UNION ALL SELECT 'SalesReportDelivery', count(*) FROM "SalesReportDelivery"
  UNION ALL SELECT 'Employee', count(*) FROM "Employee"
  UNION ALL SELECT 'KioskSession', count(*) FROM "KioskSession"
  UNION ALL SELECT 'RestockLog', count(*) FROM "RestockLog"
  UNION ALL SELECT 'HardwareMachine', count(*) FROM "HardwareMachine"
  UNION ALL SELECT 'HardwareAlertEvent', count(*) FROM "HardwareAlertEvent"
  UNION ALL SELECT '_prisma_migrations', count(*) FROM _prisma_migrations
) AS inventory
ORDER BY inventory.table_name;

SELECT 'EMPLOYEE_CODE_SEQUENCE', last_value, is_called
FROM "EmployeeCodeNumber_seq";

COMMIT;
