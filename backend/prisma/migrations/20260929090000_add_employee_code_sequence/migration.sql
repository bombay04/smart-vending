CREATE SEQUENCE "EmployeeCodeNumber_seq";

SELECT setval(
  '"EmployeeCodeNumber_seq"',
  GREATEST(
    COALESCE(
      (
        SELECT MAX(SUBSTRING("employeeCode" FROM 4)::BIGINT)
        FROM "Employee"
        WHERE "employeeCode" ~ '^EMP[0-9]+$'
      ),
      0
    ) + 1,
    1
  ),
  false
);
