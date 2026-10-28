\set ON_ERROR_STOP on

-- ISOLATED REHEARSAL ONLY. Restore the disposable database after the
-- allocation probe so its final state again represents the reset result.
ALTER SEQUENCE "EmployeeCodeNumber_seq" RESTART WITH 1;
