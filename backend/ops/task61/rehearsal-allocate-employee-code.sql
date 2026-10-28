\set ON_ERROR_STOP on

-- ISOLATED REHEARSAL ONLY. nextval is not transactionally rolled back.
SELECT nextval('"EmployeeCodeNumber_seq"') AS allocated_employee_code_number;
