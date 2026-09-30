ALTER TABLE "KioskSession"
DROP CONSTRAINT "KioskSession_employee_binding_check";

ALTER TABLE "KioskSession"
ADD CONSTRAINT "KioskSession_employee_binding_check" CHECK (
  ("type" = 'RESTOCK_AUTH' AND "employeeId" IS NULL) OR
  ("type" IN (
    'FACE_REGISTRATION',
    'EMPLOYEE_DRAFT_DELETE',
    'EMPLOYEE_OFFBOARDING'
  ) AND "employeeId" IS NOT NULL)
);
