import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import {
  createFaceRegistrationSessionWithStore,
  createRestockSessionWithStore,
  getCurrentKioskSessionWithStore,
  requireActiveKioskSessionWithStore,
  transitionKioskSessionWithStore,
  type KioskSessionRecord,
  type KioskSessionStore,
} from "./kiosk-session.service";

const NOW = new Date("2026-09-28T03:00:00.000Z");

class MemorySessionStore implements KioskSessionStore {
  sessions: KioskSessionRecord[] = [];
  employees = new Map([
    [
      1,
      {
        id: 1,
        employeeCode: "EMP001",
        name: "Active Employee",
        isActive: true,
        offboardedAt: null,
      },
    ],
    [
      2,
      {
        id: 2,
        employeeCode: "EMP002",
        name: "Inactive Employee",
        isActive: false,
        offboardedAt: null,
      },
    ],
    [
      3,
      {
        id: 3,
        employeeCode: "EMP003",
        name: "Former Employee",
        isActive: false,
        offboardedAt: new Date("2026-10-06T03:00:00.000Z"),
      },
    ],
  ]);
  nextId = 1;

  private expire(now: Date) {
    for (const session of this.sessions) {
      if (session.status === "ACTIVE" && session.expiresAt <= now) session.status = "EXPIRED";
    }
  }

  async getCurrent(machineId: string, now: Date) {
    this.expire(now);
    return (
      this.sessions.find((item) => item.machineId === machineId && item.status === "ACTIVE") ?? null
    );
  }

  async create(
    machineId: string,
    type: KioskSessionRecord["type"],
    employeeId: number | null,
    now: Date,
    expiresAt: Date,
  ) {
    this.expire(now);
    if (this.sessions.some((item) => item.machineId === machineId && item.status === "ACTIVE")) {
      throw new HttpError("Another staff session is already active for this kiosk.", 409);
    }
    const source = employeeId === null ? null : (this.employees.get(employeeId) ?? null);
    const session: KioskSessionRecord = {
      id: this.nextId++,
      machineId,
      type,
      status: "ACTIVE",
      employeeId,
      employee: source
        ? { id: source.id, employeeCode: source.employeeCode, name: source.name }
        : null,
      createdAt: now,
      expiresAt,
      completedAt: null,
    };
    this.sessions.push(session);
    return session;
  }

  async findEmployee(employeeId: number) {
    return this.employees.get(employeeId) ?? null;
  }

  async transition(sessionId: number, nextStatus: "COMPLETED" | "CANCELLED", now: Date) {
    this.expire(now);
    const session = this.sessions.find((item) => item.id === sessionId) ?? null;
    if (session?.status === "ACTIVE") {
      session.status = nextStatus;
      session.completedAt = nextStatus === "COMPLETED" ? now : null;
    }
    return session;
  }

  async findById(sessionId: number, now: Date) {
    this.expire(now);
    return this.sessions.find((item) => item.id === sessionId) ?? null;
  }
}

test("creates an unbound RESTOCK_AUTH session with a five-minute expiry", async () => {
  const store = new MemorySessionStore();
  const session = await createRestockSessionWithStore(store, NOW);
  assert.equal(session?.type, "RESTOCK_AUTH");
  assert.equal(session?.employeeId, null);
  assert.equal(new Date(session!.expiresAt).getTime() - NOW.getTime(), 300_000);
});

test("creates FACE_REGISTRATION only for an active employee and binds safe identity", async () => {
  const store = new MemorySessionStore();
  const session = await createFaceRegistrationSessionWithStore(1, store, NOW);
  assert.equal(session?.type, "FACE_REGISTRATION");
  assert.equal(session?.employeeId, 1);
  assert.deepEqual(session?.employee, { id: 1, employeeCode: "EMP001", name: "Active Employee" });
  await assert.rejects(
    createFaceRegistrationSessionWithStore(404, new MemorySessionStore(), NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  await assert.rejects(
    createFaceRegistrationSessionWithStore(2, new MemorySessionStore(), NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
});

test("offboarded employee cannot create a face-registration session", async () => {
  const store = new MemorySessionStore();
  await assert.rejects(
    createFaceRegistrationSessionWithStore(3, store, NOW),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === "EMPLOYEE_OFFBOARDED",
  );
  assert.equal(store.sessions.length, 0);
});

test("only one non-expired ACTIVE staff session controls the kiosk", async () => {
  const store = new MemorySessionStore();
  await createRestockSessionWithStore(store, NOW);
  await assert.rejects(
    createFaceRegistrationSessionWithStore(1, store, NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
});

test("expired sessions are marked EXPIRED and never returned or authorized", async () => {
  const store = new MemorySessionStore();
  const created = await createRestockSessionWithStore(store, NOW);
  const later = new Date(NOW.getTime() + 300_001);
  assert.equal(await getCurrentKioskSessionWithStore(store, later), null);
  assert.equal(store.sessions[0].status, "EXPIRED");
  await assert.rejects(
    requireActiveKioskSessionWithStore(created!.id, "RESTOCK_AUTH", store, later),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
});

test("cancellation and completion are constrained and completion is idempotent", async () => {
  const cancelledStore = new MemorySessionStore();
  const cancelled = await createRestockSessionWithStore(cancelledStore, NOW);
  assert.equal(
    (await transitionKioskSessionWithStore(cancelled!.id, "CANCELLED", cancelledStore, NOW)).status,
    "CANCELLED",
  );
  assert.equal(
    (await transitionKioskSessionWithStore(cancelled!.id, "CANCELLED", cancelledStore, NOW)).status,
    "CANCELLED",
  );
  assert.equal(await getCurrentKioskSessionWithStore(cancelledStore, NOW), null);
  await assert.rejects(
    transitionKioskSessionWithStore(cancelled!.id, "COMPLETED", cancelledStore, NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );

  const completedStore = new MemorySessionStore();
  const completed = await createRestockSessionWithStore(completedStore, NOW);
  assert.equal(
    (await transitionKioskSessionWithStore(completed!.id, "COMPLETED", completedStore, NOW)).status,
    "COMPLETED",
  );
  assert.equal(
    (await transitionKioskSessionWithStore(completed!.id, "COMPLETED", completedStore, NOW)).status,
    "COMPLETED",
  );
  await assert.rejects(
    requireActiveKioskSessionWithStore(completed!.id, "RESTOCK_AUTH", completedStore, NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
});

test("an active session cannot authorize the wrong staff flow", async () => {
  const store = new MemorySessionStore();
  const session = await createFaceRegistrationSessionWithStore(1, store, NOW);
  await assert.rejects(
    requireActiveKioskSessionWithStore(session!.id, "RESTOCK_AUTH", store, NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
});
