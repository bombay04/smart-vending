import type { KioskSessionStatus, KioskSessionType, Prisma } from "../../generated/prisma-client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";
import {
  KIOSK_SESSION_TTL_MS,
  PILOT_KIOSK_MACHINE_ID,
  type KioskSessionRecord,
} from "./kiosk-session.service";
import {
  parseEmployeeId,
  toSafeEmployee,
  type EmployeeManagementRecord,
} from "./employee-management.service";

const DRAFT_DELETE_CONFLICT =
  "This employee is not an unused draft. Preserve the employee and use Deactivate or Offboard instead.";

export interface DraftDeleteSessionSummary {
  id: number;
  type: KioskSessionType;
  status: KioskSessionStatus;
  expiresAt: Date;
}

export interface DraftDeleteCandidate extends EmployeeManagementRecord {
  restockLogCount: number;
  sessions: DraftDeleteSessionSummary[];
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseDraftDeleteResult(body: unknown): boolean {
  if (!exactObject(body, ["templateExists"]) || typeof body.templateExists !== "boolean") {
    throw new HttpError("Request body must contain only boolean templateExists.", 400);
  }
  return body.templateExists;
}

export function requireEmptyLifecycleBody(body: unknown): void {
  if (!exactObject(body, [])) throw new HttpError("Request body must be an empty object.", 400);
}

export function draftDeleteIneligibility(
  employee: DraftDeleteCandidate,
  now = new Date(),
  verificationSessionId?: number,
): string | null {
  if (employee.faceRegistered) return DRAFT_DELETE_CONFLICT;
  if (employee.restockLogCount > 0) return DRAFT_DELETE_CONFLICT;

  for (const session of employee.sessions) {
    const active = session.status === "ACTIVE" && session.expiresAt > now;
    if (active && session.id !== verificationSessionId) {
      return "Employee has an active conflicting kiosk workflow.";
    }
    if (session.type === "FACE_REGISTRATION") {
      if (session.status !== "CANCELLED" && session.status !== "EXPIRED") {
        return DRAFT_DELETE_CONFLICT;
      }
      continue;
    }
    if (session.type === "EMPLOYEE_DRAFT_DELETE") {
      if (active && session.id === verificationSessionId) continue;
      if (session.status === "CANCELLED" || session.status === "EXPIRED") continue;
      return DRAFT_DELETE_CONFLICT;
    }
    return DRAFT_DELETE_CONFLICT;
  }
  return null;
}

const employeeSelect = {
  id: true,
  employeeCode: true,
  name: true,
  isActive: true,
  faceRegistered: true,
} as const;

const lifecycleSessionSelect = {
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

async function expireElapsedSessions(transaction: Prisma.TransactionClient, now: Date) {
  await transaction.kioskSession.updateMany({
    where: { machineId: PILOT_KIOSK_MACHINE_ID, status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
}

async function loadDraftCandidate(transaction: Prisma.TransactionClient, employeeId: number) {
  const employee = await transaction.employee.findUnique({
    where: { id: employeeId },
    select: {
      ...employeeSelect,
      _count: { select: { restockLogs: true } },
      kioskSessions: { select: { id: true, type: true, status: true, expiresAt: true } },
    },
  });
  if (!employee) return null;
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    isActive: employee.isActive,
    faceRegistered: employee.faceRegistered,
    restockLogCount: employee._count.restockLogs,
    sessions: employee.kioskSessions,
  } satisfies DraftDeleteCandidate;
}

function serializeSession(session: KioskSessionRecord) {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
  };
}

function isPrismaLifecycleConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2002" ||
      error.code === "P2003" ||
      error.code === "P2025" ||
      error.code === "P2034")
  );
}

async function createEmployeeLifecycleSession(
  employeeIdValue: unknown,
  type: "EMPLOYEE_DRAFT_DELETE" | "EMPLOYEE_OFFBOARDING",
) {
  const employeeId = parseEmployeeId(employeeIdValue);
  const now = new Date();
  try {
    return await prisma.$transaction(
      async (transaction) => {
        await expireElapsedSessions(transaction, now);
        if (type === "EMPLOYEE_DRAFT_DELETE") {
          const employee = await loadDraftCandidate(transaction, employeeId);
          if (!employee) throw new HttpError("Employee not found.", 404);
          const reason = draftDeleteIneligibility(employee, now);
          if (reason) throw new HttpError(reason, 409);
        } else {
          const employee = await transaction.employee.findUnique({
            where: { id: employeeId },
            select: employeeSelect,
          });
          if (!employee) throw new HttpError("Employee not found.", 404);
          const activeEmployeeWorkflow = await transaction.kioskSession.count({
            where: { employeeId, status: "ACTIVE", expiresAt: { gt: now } },
          });
          if (activeEmployeeWorkflow > 0) {
            throw new HttpError("Employee has an active conflicting kiosk workflow.", 409);
          }
        }

        const activeKioskWorkflow = await transaction.kioskSession.count({
          where: {
            machineId: PILOT_KIOSK_MACHINE_ID,
            status: "ACTIVE",
            expiresAt: { gt: now },
          },
        });
        if (activeKioskWorkflow > 0) {
          throw new HttpError("Another staff session is already active for this kiosk.", 409);
        }

        if (type === "EMPLOYEE_OFFBOARDING") {
          await transaction.employee.update({
            where: { id: employeeId },
            data: { isActive: false },
          });
        }
        const session = await transaction.kioskSession.create({
          data: {
            machineId: PILOT_KIOSK_MACHINE_ID,
            type,
            employeeId,
            expiresAt: new Date(now.getTime() + KIOSK_SESSION_TTL_MS),
          },
          select: lifecycleSessionSelect,
        });
        return serializeSession(session);
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error: unknown) {
    if (isPrismaLifecycleConflict(error)) {
      throw new HttpError("Employee lifecycle changed concurrently. Refresh and try again.", 409);
    }
    throw error;
  }
}

export const startDraftDelete = (employeeId: unknown) =>
  createEmployeeLifecycleSession(employeeId, "EMPLOYEE_DRAFT_DELETE");

export const startOffboarding = (employeeId: unknown) =>
  createEmployeeLifecycleSession(employeeId, "EMPLOYEE_OFFBOARDING");

async function requireLifecycleSession(
  transaction: Prisma.TransactionClient,
  sessionId: number,
  type: "EMPLOYEE_DRAFT_DELETE" | "EMPLOYEE_OFFBOARDING",
  now: Date,
) {
  const session = await transaction.kioskSession.findUnique({
    where: { id: sessionId },
    select: lifecycleSessionSelect,
  });
  if (!session) throw new HttpError("Kiosk session not found.", 404);
  if (
    session.machineId !== PILOT_KIOSK_MACHINE_ID ||
    session.type !== type ||
    session.employeeId === null ||
    session.employee === null
  ) {
    throw new HttpError("Kiosk session is not authorized for this cleanup workflow.", 403);
  }
  if (session.status === "ACTIVE" && session.expiresAt <= now) {
    throw new HttpError("Kiosk session has expired.", 409);
  }
  return session;
}

export async function completeOffboarding(sessionIdValue: unknown) {
  const sessionId = parseEmployeeId(sessionIdValue);
  const now = new Date();
  try {
    return await prisma.$transaction(
      async (transaction) => {
        const session = await requireLifecycleSession(
          transaction,
          sessionId,
          "EMPLOYEE_OFFBOARDING",
          now,
        );
        if (session.status === "COMPLETED") {
          const employee = await transaction.employee.findUnique({
            where: { id: session.employeeId! },
            select: employeeSelect,
          });
          if (!employee) throw new HttpError("Employee not found.", 404);
          return { session: serializeSession(session), employee: toSafeEmployee(employee) };
        }
        if (session.status !== "ACTIVE") {
          throw new HttpError(`Kiosk session is already ${session.status.toLowerCase()}.`, 409);
        }
        const employee = await transaction.employee.update({
          where: { id: session.employeeId! },
          data: { isActive: false, faceRegistered: false },
          select: employeeSelect,
        });
        const completed = await transaction.kioskSession.update({
          where: { id: session.id },
          data: { status: "COMPLETED", completedAt: now },
          select: lifecycleSessionSelect,
        });
        return { session: serializeSession(completed), employee: toSafeEmployee(employee) };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error: unknown) {
    if (isPrismaLifecycleConflict(error)) {
      throw new HttpError("Offboarding completion conflicted with another change.", 409);
    }
    throw error;
  }
}

export async function finalizeDraftDelete(sessionIdValue: unknown, body: unknown) {
  const sessionId = parseEmployeeId(sessionIdValue);
  const templateExists = parseDraftDeleteResult(body);
  const now = new Date();
  try {
    const outcome = await prisma.$transaction(
      async (transaction) => {
        const session = await requireLifecycleSession(
          transaction,
          sessionId,
          "EMPLOYEE_DRAFT_DELETE",
          now,
        );
        if (session.status !== "ACTIVE") {
          throw new HttpError(`Kiosk session is already ${session.status.toLowerCase()}.`, 409);
        }
        const employeeId = session.employeeId!;
        if (templateExists) {
          const employee = await transaction.employee.update({
            where: { id: employeeId },
            data: { isActive: false, faceRegistered: true },
            select: employeeSelect,
          });
          await transaction.kioskSession.update({
            where: { id: session.id },
            data: { status: "COMPLETED", completedAt: now },
          });
          return { kind: "PRESERVED" as const, employee: toSafeEmployee(employee) };
        }

        const candidate = await loadDraftCandidate(transaction, employeeId);
        if (!candidate) throw new HttpError("Employee not found.", 404);
        const reason = draftDeleteIneligibility(candidate, now, session.id);
        if (reason) {
          await transaction.kioskSession.update({
            where: { id: session.id },
            data: { status: "CANCELLED" },
          });
          return { kind: "CONFLICT" as const, reason };
        }

        await transaction.kioskSession.deleteMany({
          where: {
            employeeId,
            OR: [
              { type: "FACE_REGISTRATION", status: { in: ["CANCELLED", "EXPIRED"] } },
              { type: "EMPLOYEE_DRAFT_DELETE" },
            ],
          },
        });
        await transaction.employee.delete({ where: { id: employeeId } });
        return {
          kind: "DELETED" as const,
          employeeId,
          employeeCode: session.employee!.employeeCode,
        };
      },
      { isolationLevel: "Serializable" },
    );

    if (outcome.kind === "CONFLICT") throw new HttpError(outcome.reason, 409);
    if (outcome.kind === "PRESERVED") {
      return {
        deleted: false,
        employee: outcome.employee,
        message: "Local face data exists; use Offboard to remove it.",
      };
    }
    return { deleted: true, employeeId: outcome.employeeId, employeeCode: outcome.employeeCode };
  } catch (error: unknown) {
    if (isPrismaLifecycleConflict(error)) {
      throw new HttpError(
        "Employee lifecycle changed concurrently. The draft was not deleted.",
        409,
      );
    }
    throw error;
  }
}
