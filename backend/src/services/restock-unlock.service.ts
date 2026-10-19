import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";
import { PILOT_KIOSK_MACHINE_ID } from "./kiosk-session.service";
import {
  getRestockUnlockSecret,
  signRestockUnlockAuthorization,
  verifyFaceAuthorization,
} from "./restock-authorization";

export const RESTOCK_UNLOCK_GRANT_TTL_MS = 10_000;
const PHYSICAL_SLOT_NUMBERS = [1, 2, 3] as const;

interface RestockUnlockContext {
  session: {
    id: number;
    machineId: string;
    type: string;
    status: string;
    expiresAt: Date;
  } | null;
  employee: { id: number; employeeCode: string; isActive: boolean } | null;
  hasActivePayment: boolean;
}

export interface RestockUnlockGrantStore {
  getContext(sessionId: number, employeeCode: string, now: Date): Promise<RestockUnlockContext>;
}

const prismaRestockUnlockGrantStore: RestockUnlockGrantStore = {
  async getContext(sessionId, employeeCode, now) {
    return prisma.$transaction(async (database) => {
      await database.kioskSession.updateMany({
        where: { id: sessionId, status: "ACTIVE", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      const [session, employee, activePayment] = await Promise.all([
        database.kioskSession.findUnique({
          where: { id: sessionId },
          select: { id: true, machineId: true, type: true, status: true, expiresAt: true },
        }),
        database.employee.findUnique({
          where: { employeeCode },
          select: { id: true, employeeCode: true, isActive: true },
        }),
        database.transaction.findFirst({
          where: { paymentStatus: "PENDING", customerCancelledAt: null },
          select: { id: true },
        }),
      ]);
      return { session, employee, hasActivePayment: activePayment !== null };
    });
  },
};

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(`${field} must be a positive integer.`, 400);
  }
  return value;
}

function physicalSlotNumber(value: unknown): number {
  const slotNumber = positiveInteger(value, "slotNumber");
  if (!PHYSICAL_SLOT_NUMBERS.includes(slotNumber as (typeof PHYSICAL_SLOT_NUMBERS)[number])) {
    throw new HttpError("slotNumber must be an integer: 1, 2, or 3.", 400);
  }
  return slotNumber;
}

export async function createRestockUnlockGrantWithDependencies(
  body: unknown,
  store: RestockUnlockGrantStore,
  secret: string,
  now = new Date(),
) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError("Invalid restock unlock request.", 400);
  }
  const request = body as Record<string, unknown>;
  if (
    Object.keys(request).some(
      (key) => !["sessionId", "slotNumber", "faceAuthorization"].includes(key),
    )
  ) {
    throw new HttpError("Invalid restock unlock request.", 400);
  }

  const sessionId = positiveInteger(request.sessionId, "sessionId");
  const slotNumber = physicalSlotNumber(request.slotNumber);
  const face = verifyFaceAuthorization(request.faceAuthorization, sessionId, secret, now);
  const context = await store.getContext(sessionId, face.employeeCode, now);
  const session = context.session;

  if (
    !session ||
    session.machineId !== PILOT_KIOSK_MACHINE_ID ||
    session.type !== "RESTOCK_AUTH" ||
    session.status !== "ACTIVE" ||
    session.expiresAt <= now
  ) {
    throw new HttpError("เซสชันเติมสินค้าไม่ถูกต้องหรือหมดอายุแล้ว", 403);
  }
  if (!context.employee || !context.employee.isActive) {
    throw new HttpError("พนักงานไม่ได้รับอนุญาต", 403);
  }
  if (context.hasActivePayment) {
    throw new HttpError("ไม่สามารถเปิดช่องระหว่างมีการชำระเงิน", 409);
  }

  const expiresAt = Math.min(
    session.expiresAt.getTime(),
    now.getTime() + RESTOCK_UNLOCK_GRANT_TTL_MS,
  );
  const authorization = signRestockUnlockAuthorization(
    {
      v: 1,
      purpose: "RESTOCK_UNLOCK",
      machineId: PILOT_KIOSK_MACHINE_ID,
      sessionId,
      employeeId: context.employee.id,
      slotNumber,
      expiresAt,
      nonce: randomBytes(16).toString("base64url"),
    },
    secret,
  );

  return { authorization, expiresAt: new Date(expiresAt).toISOString() };
}

export function createRestockUnlockGrant(body: unknown) {
  return createRestockUnlockGrantWithDependencies(
    body,
    prismaRestockUnlockGrantStore,
    getRestockUnlockSecret(),
  );
}
