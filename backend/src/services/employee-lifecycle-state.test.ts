import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  assertEmployeeNotOffboarded,
  classifyEmployeeLifecycle,
  EMPLOYEE_OFFBOARDED_CODE,
  EMPLOYEE_OFFBOARDED_MESSAGE,
  isCurrentEmployee,
} from "./employee-lifecycle-state";

const OFFBOARDED_AT = new Date("2026-10-06T03:00:00.000Z");

test("employee lifecycle distinguishes active, deactivated, and terminal offboarded records", () => {
  assert.equal(classifyEmployeeLifecycle({ isActive: true, offboardedAt: null }), "ACTIVE");
  assert.equal(classifyEmployeeLifecycle({ isActive: false, offboardedAt: null }), "DEACTIVATED");
  assert.equal(
    classifyEmployeeLifecycle({ isActive: false, offboardedAt: OFFBOARDED_AT }),
    "OFFBOARDED",
  );
  assert.equal(isCurrentEmployee({ offboardedAt: null }), true);
  assert.equal(isCurrentEmployee({ offboardedAt: OFFBOARDED_AT }), false);
});

test("offboarded lifecycle guard exposes the stable HTTP 409 response", () => {
  assert.doesNotThrow(() => assertEmployeeNotOffboarded({ offboardedAt: null }));
  assert.throws(
    () => assertEmployeeNotOffboarded({ offboardedAt: OFFBOARDED_AT }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === EMPLOYEE_OFFBOARDED_CODE &&
      error.message === EMPLOYEE_OFFBOARDED_MESSAGE,
  );
});
