import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  completeFaceRegistrationWithUpdate,
  createEmployeeWithRetry,
  deleteEmployeeWithStore,
  formatEmployeeCode,
  parseCreateEmployeeRequest,
  parseFaceRegistrationCompleteRequest,
  parseUpdateEmployeeRequest,
  updateEmployeeWithConflictHandling,
  updateEmployeeWithStore,
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

  const created = await createEmployeeWithRetry(" Somchai ", async (name) => ({
    ...newEmployee,
    name,
  }));
  assert.deepEqual(created, newEmployee);
  assert.equal("faceEmbedding" in created, false);
});

test("employee codes format sequential values with at least three digits", () => {
  assert.equal(formatEmployeeCode(1n), "EMP001");
  assert.equal(formatEmployeeCode(10n), "EMP010");
  assert.equal(formatEmployeeCode(1000n), "EMP1000");
});

test("employee code allocation uses a durable sequence initialized above existing codes", async () => {
  const migration = await readFile(
    resolve("prisma/migrations/20260929090000_add_employee_code_sequence/migration.sql"),
    "utf8",
  );
  assert.match(migration, /CREATE SEQUENCE "EmployeeCodeNumber_seq"/);
  assert.match(migration, /MAX\(SUBSTRING\("employeeCode" FROM 4\)::BIGINT\)/);
  assert.match(migration, /\+ 1/);
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

test("employee update trims names and changes only allowed fields", async () => {
  let employee = { ...newEmployee };
  const store = {
    async findEmployee() {
      return employee;
    },
    async countActiveFaceRegistrationSessions() {
      return 0;
    },
    async updateEmployee(_employeeId: number, data: { name?: string; isActive?: boolean }) {
      employee = { ...employee, ...data };
      return employee;
    },
  };

  assert.deepEqual(parseUpdateEmployeeRequest({ name: "  Mali  " }), { name: "Mali" });
  assert.equal((await updateEmployeeWithStore("2", { name: "  Mali  " }, store)).name, "Mali");
  assert.equal((await updateEmployeeWithStore(2, { isActive: false }, store)).isActive, false);
  assert.equal((await updateEmployeeWithStore(2, { isActive: true }, store)).isActive, true);
});

test("employee update rejects invalid and immutable fields", () => {
  for (const body of [
    {},
    { name: "   " },
    { name: 42 },
    { isActive: "false" },
    { employeeCode: "EMP999" },
    { faceRegistered: true },
    { faceEmbedding: [0.1] },
    { name: "Mali", unexpected: true },
  ]) {
    assert.throws(
      () => parseUpdateEmployeeRequest(body),
      (error: unknown) => error instanceof HttpError && error.statusCode === 400,
    );
  }
});

test("employee update returns 404 for an unknown employee", async () => {
  await assert.rejects(
    updateEmployeeWithStore(
      999,
      { name: "Mali" },
      {
        async findEmployee() {
          return null;
        },
        async countActiveFaceRegistrationSessions() {
          return 0;
        },
        async updateEmployee() {
          throw new Error("must not update");
        },
      },
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
});

test("active face-registration session blocks deactivation", async () => {
  let updated = false;
  await assert.rejects(
    updateEmployeeWithStore(
      2,
      { isActive: false },
      {
        async findEmployee() {
          return newEmployee;
        },
        async countActiveFaceRegistrationSessions() {
          return 1;
        },
        async updateEmployee() {
          updated = true;
          return { ...newEmployee, isActive: false };
        },
      },
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(updated, false);
});

test("employee update translates Prisma P2034 to a safe 409 without retrying", async () => {
  let attempts = 0;
  await assert.rejects(
    updateEmployeeWithConflictHandling(async () => {
      attempts += 1;
      throw { code: "P2034", message: "unsafe database detail" };
    }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      /refresh.*try again/i.test(error.message) &&
      !error.message.includes("unsafe database detail"),
  );
  assert.equal(attempts, 1);
});

function deleteCandidate(
  overrides: Partial<{
    faceRegistered: boolean;
    restockLogCount: number;
    kioskSessionCount: number;
  }> = {},
) {
  return {
    ...newEmployee,
    restockLogCount: 0,
    kioskSessionCount: 0,
    ...overrides,
  };
}

test("unused employee can be deleted", async () => {
  let employee = deleteCandidate();
  await deleteEmployeeWithStore(2, {
    async findEmployee() {
      return employee;
    },
    async deleteEmployee() {
      employee = null as never;
    },
  });
  assert.equal(employee, null);
});

test("employee delete returns 404 for an unknown employee", async () => {
  await assert.rejects(
    deleteEmployeeWithStore(999, {
      async findEmployee() {
        return null;
      },
      async deleteEmployee() {
        throw new Error("must not delete");
      },
    }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
});

for (const scenario of [
  ["registered employee", { faceRegistered: true }],
  ["employee with FACE_REGISTRATION session history", { kioskSessionCount: 1 }],
  ["employee with an active employee-bound session", { kioskSessionCount: 1 }],
  ["employee referenced by restock history", { restockLogCount: 1 }],
] as const) {
  test(`${scenario[0]} cannot be deleted and remains intact`, async () => {
    const employee = deleteCandidate(scenario[1]);
    let deleted = false;
    await assert.rejects(
      deleteEmployeeWithStore(2, {
        async findEmployee() {
          return employee;
        },
        async deleteEmployee() {
          deleted = true;
        },
      }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 409 &&
        /deactivate.*instead/i.test(error.message),
    );
    assert.equal(deleted, false);
    assert.deepEqual(employee, deleteCandidate(scenario[1]));
  });
}

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
