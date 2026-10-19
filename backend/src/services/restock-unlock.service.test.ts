import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { HttpError } from "../utils/http-error";
import { getRestockUnlockSecret } from "./restock-authorization";
import {
  createRestockUnlockGrantWithDependencies,
  type RestockUnlockGrantStore,
} from "./restock-unlock.service";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const SECRET = "test-restock-unlock-secret-32-characters";

function faceAuthorization(overrides: Record<string, unknown> = {}) {
  const encoded = Buffer.from(
    JSON.stringify({
      v: 1,
      purpose: "FACE_MATCH",
      machineId: "PILOT_KIOSK",
      sessionId: 17,
      employeeCode: "EMP004",
      expiresAt: NOW.getTime() + 300_000,
      nonce: "face-proof-nonce-123456",
      ...overrides,
    }),
  ).toString("base64url");
  return `${encoded}.${createHmac("sha256", SECRET).update(encoded).digest("base64url")}`;
}

function store(
  overrides: Partial<Awaited<ReturnType<RestockUnlockGrantStore["getContext"]>>> = {},
) {
  const context = {
    session: {
      id: 17,
      machineId: "PILOT_KIOSK",
      type: "RESTOCK_AUTH",
      status: "ACTIVE",
      expiresAt: new Date(NOW.getTime() + 300_000),
    },
    employee: { id: 4, employeeCode: "EMP004", isActive: true },
    hasActivePayment: false,
    ...overrides,
  };
  return {
    async getContext(sessionId: number, employeeCode: string) {
      assert.equal(sessionId, 17);
      assert.equal(employeeCode, "EMP004");
      return context;
    },
  } satisfies RestockUnlockGrantStore;
}

const request = (slotNumber = 2, authorization = faceAuthorization()) => ({
  sessionId: 17,
  slotNumber,
  faceAuthorization: authorization,
});

test("missing or undersized shared secrets fail closed", () => {
  const originalSecret = process.env.RESTOCK_UNLOCK_SECRET;
  try {
    delete process.env.RESTOCK_UNLOCK_SECRET;
    assert.throws(
      () => getRestockUnlockSecret(),
      (error: unknown) => error instanceof HttpError && error.statusCode === 503,
    );
    process.env.RESTOCK_UNLOCK_SECRET = "too-short";
    assert.throws(
      () => getRestockUnlockSecret(),
      (error: unknown) => error instanceof HttpError && error.statusCode === 503,
    );
  } finally {
    if (originalSecret === undefined) delete process.env.RESTOCK_UNLOCK_SECRET;
    else process.env.RESTOCK_UNLOCK_SECRET = originalSecret;
  }
});

test("issues a signed, short-lived grant bound to the recognized employee and slot", async () => {
  const grant = await createRestockUnlockGrantWithDependencies(request(), store(), SECRET, NOW);
  const [encoded, signature] = grant.authorization.split(".");
  assert.equal(createHmac("sha256", SECRET).update(encoded).digest("base64url"), signature);
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(payload.sessionId, 17);
  assert.equal(payload.employeeId, 4);
  assert.equal(payload.slotNumber, 2);
  assert.equal(payload.expiresAt, NOW.getTime() + 10_000);
});

test("forged, mismatched, and expired face proofs cannot authorize unlock", async () => {
  for (const authorization of [
    `${faceAuthorization()}tampered`,
    faceAuthorization({ sessionId: 18 }),
    faceAuthorization({ expiresAt: NOW.getTime() }),
  ]) {
    await assert.rejects(
      createRestockUnlockGrantWithDependencies(request(1, authorization), store(), SECRET, NOW),
      (error: unknown) => error instanceof HttpError && error.statusCode === 403,
    );
  }
});

test("expired, cancelled, and wrong-flow sessions cannot authorize unlock", async () => {
  for (const session of [
    null,
    {
      id: 17,
      machineId: "PILOT_KIOSK",
      type: "RESTOCK_AUTH",
      status: "CANCELLED",
      expiresAt: new Date(NOW.getTime() + 1_000),
    },
    { id: 17, machineId: "PILOT_KIOSK", type: "RESTOCK_AUTH", status: "ACTIVE", expiresAt: NOW },
    {
      id: 17,
      machineId: "PILOT_KIOSK",
      type: "FACE_REGISTRATION",
      status: "ACTIVE",
      expiresAt: new Date(NOW.getTime() + 1_000),
    },
  ]) {
    await assert.rejects(
      createRestockUnlockGrantWithDependencies(request(1), store({ session }), SECRET, NOW),
      (error: unknown) => error instanceof HttpError && error.statusCode === 403,
    );
  }
});

test("active payments, inactive employees, and invalid slots fail before a grant", async () => {
  await assert.rejects(
    createRestockUnlockGrantWithDependencies(
      request(1),
      store({ hasActivePayment: true }),
      SECRET,
      NOW,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  await assert.rejects(
    createRestockUnlockGrantWithDependencies(
      request(1),
      store({ employee: { id: 4, employeeCode: "EMP004", isActive: false } }),
      SECRET,
      NOW,
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  await assert.rejects(
    createRestockUnlockGrantWithDependencies(request(4), store(), SECRET, NOW),
    (error: unknown) => error instanceof HttpError && error.statusCode === 400,
  );
});

test("grant issuance never mutates slot inventory or payment unlock records", async () => {
  const source = await readFile(resolve("src/services/restock-unlock.service.ts"), "utf8");
  assert.doesNotMatch(source, /slot\.(?:update|updateMany)|status:\s*"AVAILABLE"/);
  assert.doesNotMatch(source, /transactionId|unlock_transaction_outcomes/);
});
