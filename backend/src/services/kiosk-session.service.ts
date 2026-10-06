import type { KioskSessionStatus, KioskSessionType, Prisma } from "../../generated/prisma-client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";
import { assertEmployeeNotOffboarded } from "./employee-lifecycle-state";

export const PILOT_KIOSK_MACHINE_ID = process.env.KIOSK_MACHINE_ID?.trim() || "PILOT_KIOSK";
export const KIOSK_SESSION_TTL_MS = 5 * 60 * 1000;

export interface KioskSessionEmployee {
  id: number;
  employeeCode: string;
  name: string;
}

export interface KioskSessionRecord {
  id: number;
  machineId: string;
  type: KioskSessionType;
  status: KioskSessionStatus;
  employeeId: number | null;
  createdAt: Date;
  expiresAt: Date;
  completedAt: Date | null;
  employee: KioskSessionEmployee | null;
}

export interface KioskSessionStore {
  getCurrent(machineId: string, now: Date): Promise<KioskSessionRecord | null>;
  create(
    machineId: string,
    type: KioskSessionType,
    employeeId: number | null,
    now: Date,
    expiresAt: Date,
  ): Promise<KioskSessionRecord>;
  findEmployee(
    employeeId: number,
  ): Promise<(KioskSessionEmployee & { isActive: boolean; offboardedAt?: Date | null }) | null>;
  transition(
    sessionId: number,
    nextStatus: "COMPLETED" | "CANCELLED",
    now: Date,
  ): Promise<KioskSessionRecord | null>;
  findById(sessionId: number, now: Date): Promise<KioskSessionRecord | null>;
}

const sessionSelect = {
  id: true,
  machineId: true,
  type: true,
  status: true,
  employeeId: true,
  createdAt: true,
  expiresAt: true,
  completedAt: true,
  employee: { select: { id: true, employeeCode: true, name: true } },
} as const;

async function expireElapsedSessions(
  transaction: Prisma.TransactionClient,
  machineId: string,
  now: Date,
): Promise<void> {
  await transaction.kioskSession.updateMany({
    where: { machineId, status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
}

const prismaKioskSessionStore: KioskSessionStore = {
  async getCurrent(machineId, now) {
    return prisma.$transaction(async (transaction) => {
      await expireElapsedSessions(transaction, machineId, now);
      return transaction.kioskSession.findFirst({
        where: { machineId, status: "ACTIVE", expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        select: sessionSelect,
      });
    });
  },

  async create(machineId, type, employeeId, now, expiresAt) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          await expireElapsedSessions(transaction, machineId, now);
          return transaction.kioskSession.create({
            data: { machineId, type, employeeId, expiresAt },
            select: sessionSelect,
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if (error.code === "P2002" || error.code === "P2034") {
          throw new HttpError("Another staff session is already active for this kiosk.", 409);
        }
      }
      throw error;
    }
  },

  findEmployee(employeeId) {
    return prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, employeeCode: true, name: true, isActive: true, offboardedAt: true },
    });
  },

  async transition(sessionId, nextStatus, now) {
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.kioskSession.findUnique({
        where: { id: sessionId },
        select: sessionSelect,
      });
      if (!existing) return null;
      if (existing.status === "ACTIVE" && existing.expiresAt <= now) {
        return transaction.kioskSession.update({
          where: { id: sessionId },
          data: { status: "EXPIRED" },
          select: sessionSelect,
        });
      }
      if (existing.status !== "ACTIVE") return existing;
      return transaction.kioskSession.update({
        where: { id: sessionId },
        data: {
          status: nextStatus,
          completedAt: nextStatus === "COMPLETED" ? now : null,
        },
        select: sessionSelect,
      });
    });
  },

  async findById(sessionId, now) {
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.kioskSession.findUnique({
        where: { id: sessionId },
        select: sessionSelect,
      });
      if (existing?.status === "ACTIVE" && existing.expiresAt <= now) {
        return transaction.kioskSession.update({
          where: { id: sessionId },
          data: { status: "EXPIRED" },
          select: sessionSelect,
        });
      }
      return existing;
    });
  },
};

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(`${field} must be a positive integer.`, 400);
  }
  return value;
}

function safeSession(session: KioskSessionRecord | null) {
  if (!session || session.status !== "ACTIVE") return null;
  return {
    id: session.id,
    machineId: session.machineId,
    type: session.type,
    status: session.status,
    employeeId: session.employeeId,
    employee: session.employee,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}

export async function getCurrentKioskSessionWithStore(store: KioskSessionStore, now = new Date()) {
  return safeSession(await store.getCurrent(PILOT_KIOSK_MACHINE_ID, now));
}

export async function createRestockSessionWithStore(store: KioskSessionStore, now = new Date()) {
  const expiresAt = new Date(now.getTime() + KIOSK_SESSION_TTL_MS);
  return safeSession(
    await store.create(PILOT_KIOSK_MACHINE_ID, "RESTOCK_AUTH", null, now, expiresAt),
  );
}

export async function createFaceRegistrationSessionWithStore(
  employeeIdValue: unknown,
  store: KioskSessionStore,
  now = new Date(),
) {
  const employeeId = positiveInteger(employeeIdValue, "employeeId");
  const employee = await store.findEmployee(employeeId);
  if (!employee) throw new HttpError("Employee not found.", 404);
  assertEmployeeNotOffboarded(employee);
  if (!employee.isActive) throw new HttpError("Employee is inactive.", 409);
  const expiresAt = new Date(now.getTime() + KIOSK_SESSION_TTL_MS);
  return safeSession(
    await store.create(PILOT_KIOSK_MACHINE_ID, "FACE_REGISTRATION", employeeId, now, expiresAt),
  );
}

export async function transitionKioskSessionWithStore(
  sessionIdValue: unknown,
  nextStatus: "COMPLETED" | "CANCELLED",
  store: KioskSessionStore,
  now = new Date(),
) {
  const sessionId = positiveInteger(sessionIdValue, "sessionId");
  const session = await store.transition(sessionId, nextStatus, now);
  if (!session) throw new HttpError("Kiosk session not found.", 404);
  if (session.machineId !== PILOT_KIOSK_MACHINE_ID) {
    throw new HttpError("Kiosk session not found.", 404);
  }
  if (
    session.status === nextStatus ||
    (nextStatus === "COMPLETED" && session.status === "COMPLETED")
  ) {
    return { ...safeCompletedSession(session) };
  }
  if (session.status === "EXPIRED") throw new HttpError("Kiosk session has expired.", 409);
  throw new HttpError(`Kiosk session is already ${session.status.toLowerCase()}.`, 409);
}

function safeCompletedSession(session: KioskSessionRecord) {
  return {
    id: session.id,
    machineId: session.machineId,
    type: session.type,
    status: session.status,
    employeeId: session.employeeId,
    employee: session.employee,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}

export async function requireActiveKioskSessionWithStore(
  sessionIdValue: unknown,
  requiredType: KioskSessionType,
  store: KioskSessionStore,
  now = new Date(),
): Promise<KioskSessionRecord> {
  const sessionId = positiveInteger(sessionIdValue, "sessionId");
  const session = await store.findById(sessionId, now);
  if (
    !session ||
    session.machineId !== PILOT_KIOSK_MACHINE_ID ||
    session.status !== "ACTIVE" ||
    session.expiresAt <= now ||
    session.type !== requiredType
  ) {
    throw new HttpError("A valid active kiosk session is required.", 403);
  }
  return session;
}

export const getCurrentKioskSession = () =>
  getCurrentKioskSessionWithStore(prismaKioskSessionStore);
export const createRestockSession = () => createRestockSessionWithStore(prismaKioskSessionStore);
export const createFaceRegistrationSession = (employeeId: unknown) =>
  createFaceRegistrationSessionWithStore(employeeId, prismaKioskSessionStore);
export const completeKioskSession = (sessionId: unknown) =>
  transitionKioskSessionWithStore(sessionId, "COMPLETED", prismaKioskSessionStore);
export const cancelKioskSession = (sessionId: unknown) =>
  transitionKioskSessionWithStore(sessionId, "CANCELLED", prismaKioskSessionStore);
export const requireActiveKioskSession = (sessionId: unknown, type: KioskSessionType) =>
  requireActiveKioskSessionWithStore(sessionId, type, prismaKioskSessionStore);
