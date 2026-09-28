import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  buildNewEmployeeData,
  completeFaceRegistrationWithUpdate,
  createEmployeeWithRetry,
  nextEmployeeCode,
  parseCreateEmployeeRequest,
  parseFaceRegistrationCompleteRequest,
} from "./employee-management.service";

const newEmployee = {
  id: 2,
  employeeCode: "EMP002",
  name: "Somchai",
  isActive: true,
  faceRegistered: false,
};

test("employee creation accepts name only and starts without biometric metadata", async () => {
  assert.equal(parseCreateEmployeeRequest({ name: "  Somchai  " }), "Somchai");
  const data = buildNewEmployeeData("Somchai", ["EMP001"]);
  assert.deepEqual(data, {
    name: "Somchai",
    employeeCode: "EMP002",
    isActive: true,
    faceRegistered: false,
  });
  assert.equal("faceEmbedding" in data, false);

  const created = await createEmployeeWithRetry(" Somchai ", async (name) => ({
    ...newEmployee,
    name,
  }));
  assert.deepEqual(created, newEmployee);
  assert.equal("faceEmbedding" in created, false);
});

test("employee codes advance sequentially with at least three digits", () => {
  assert.equal(nextEmployeeCode([]), "EMP001");
  assert.equal(nextEmployeeCode(["EMP001"]), "EMP002");
  assert.equal(nextEmployeeCode(["EMP001", "EMP009", "OTHER"]), "EMP010");
  assert.equal(nextEmployeeCode(["EMP999"]), "EMP1000");
});

test("employee creation retries a prototype concurrency conflict", async () => {
  const conflict = { code: "P2002" };
  let attempts = 0;
  const created = await createEmployeeWithRetry(
    "Somchai",
    async () => {
      attempts += 1;
      if (attempts === 1) throw conflict;
      return newEmployee;
    },
    (error) => error === conflict,
  );
  assert.equal(attempts, 2);
  assert.deepEqual(created, newEmployee);
});

test("employee creation rejects code and biometric fields", () => {
  for (const body of [
    { name: "Somchai", employeeCode: "EMP002" },
    { name: "Somchai", faceEmbedding: [0.1] },
    { name: "Somchai", faceRegistered: true },
  ]) {
    assert.throws(
      () => parseCreateEmployeeRequest(body),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
  }
});

test("registration completion accepts only a session id", () => {
  assert.equal(parseFaceRegistrationCompleteRequest({ sessionId: 12 }), 12);
  for (const body of [
    { employeeCode: "EMP002" },
    { sessionId: 12, faceEmbedding: [0.1] },
    { sessionId: "12" },
  ]) {
    assert.throws(
      () => parseFaceRegistrationCompleteRequest(body),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
  }
});

test("registration completion marks an active employee using safe metadata", async () => {
  let lookedUpCode: string | undefined;
  const employee = await completeFaceRegistrationWithUpdate(
    { sessionId: 12 },
    async (sessionId) => {
      lookedUpCode = String(sessionId);
      return newEmployee;
    },
  );
  assert.equal(lookedUpCode, "12");
  assert.equal(employee.faceRegistered, true);
  assert.equal("faceEmbedding" in employee, false);
});

test("registration completion rejects unknown and inactive employees", async () => {
  await assert.rejects(
    completeFaceRegistrationWithUpdate({ sessionId: 12 }, async () => null),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401,
  );
  await assert.rejects(
    completeFaceRegistrationWithUpdate({ sessionId: 12 }, async () => ({
      ...newEmployee,
      isActive: false,
    })),
    (error: unknown) => error instanceof HttpError && error.statusCode === 401,
  );
});
