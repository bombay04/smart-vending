-- RESTOCK_AUTH sessions start without an employee and are bound only after
-- the Backend verifies the signed face authorization and active employee.
BEGIN;

ALTER TABLE "KioskSession"
DROP CONSTRAINT "KioskSession_employee_binding_check";

ALTER TABLE "KioskSession"
ADD CONSTRAINT "KioskSession_employee_binding_check" CHECK (
  ("type" = 'RESTOCK_AUTH') OR
  ("type" IN (
    'FACE_REGISTRATION',
    'EMPLOYEE_DRAFT_DELETE',
    'EMPLOYEE_OFFBOARDING'
  ) AND "employeeId" IS NOT NULL)
);

COMMIT;
