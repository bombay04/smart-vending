import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  authenticateEmployeeWithLookup,
  listEmployeesForFaceRegistrationWithLookup,
  normalizeEmployeeCode,
} from "./employee-auth.service";

const activeEmployee = {
  id: 1,
  name: "Prototype Employee",
  employeeCode: "EMP001",
  isActive: true,
};

test("active employee authentication returns only safe identity fields", async () => {
  const employee = await authenticateEmployeeWithLookup("EMP001", async () => activeEmployee);

  assert.deepEqual(employee, {
    id: 1,
    name: "Prototype Employee",
    employeeCode: "EMP001",
  });
  assert.equal("isActive" in employee, false);
  assert.equal("faceEmbedding" in employee, false);
});

test("employee codes are trimmed and normalized before lookup", async () => {
  let lookedUpCode: string | undefined;

  await authenticateEmployeeWithLookup("  emp001  ", async (employeeCode) => {
    lookedUpCode = employeeCode;
    return activeEmployee;
  });

  assert.equal(lookedUpCode, "EMP001");
  assert.equal(normalizeEmployeeCode(" emp001 "), "EMP001");
});

test("unknown employees are rejected with HTTP 401", async () => {
  await assert.rejects(
    authenticateEmployeeWithLookup("EMP404", async () => null),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401,
  );
});

test("inactive employees are rejected with HTTP 401", async () => {
  await assert.rejects(
    authenticateEmployeeWithLookup("EMP001", async () => ({
      ...activeEmployee,
      isActive: false,
    })),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401,
  );
});

test("empty and malformed employee codes are rejected with HTTP 400", async () => {
  for (const employeeCode of ["", "   ", null, undefined, 123, {}]) {
    let lookupCalled = false;

    await assert.rejects(
      authenticateEmployeeWithLookup(employeeCode, async () => {
        lookupCalled = true;
        return activeEmployee;
      }),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
    assert.equal(lookupCalled, false);
  }
});

test("registration employee list returns active and inactive safe metadata", async () => {
  const employees = await listEmployeesForFaceRegistrationWithLookup(async () => [
    { ...activeEmployee, faceRegistered: true, faceEmbedding: [0.1, 0.2] },
    {
      id: 2,
      name: "Inactive Employee",
      employeeCode: "EMP002",
      isActive: false,
      faceRegistered: false,
      faceEmbedding: [0.3, 0.4],
    },
  ]);

  assert.deepEqual(employees, [
    {
      id: 1,
      name: "Prototype Employee",
      employeeCode: "EMP001",
      isActive: true,
      faceRegistered: true,
    },
    {
      id: 2,
      name: "Inactive Employee",
      employeeCode: "EMP002",
      isActive: false,
      faceRegistered: false,
    },
  ]);
  for (const employee of employees) {
    assert.equal("faceEmbedding" in employee, false);
  }
});
