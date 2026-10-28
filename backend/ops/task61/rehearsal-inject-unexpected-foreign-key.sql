\set ON_ERROR_STOP on

-- ISOLATED REHEARSAL ONLY. Add an unexpected dependent table so the reviewed
-- foreign-key allowlist can be proven to fail closed.
CREATE TABLE task61_unexpected_employee_reference (
  id integer PRIMARY KEY,
  employee_id integer NOT NULL REFERENCES "Employee"(id)
);
