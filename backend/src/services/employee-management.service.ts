import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";
import { PILOT_KIOSK_MACHINE_ID } from "./kiosk-session.service";

const EMPLOYEE_CODE_PATTERN = /^EMP(\d+)$/;
const MAX_EMPLOYEE_NAME_LENGTH = 120;
const MAX_CREATE_ATTEMPTS = 3;

export interface EmployeeManagementRecord {
  id: number;
  employeeCode: string;
  name: string;
  isActive: boolean;
  faceRegistered: boolean;
}

interface NewEmployeeData {
  name: string;
  employeeCode: string;
  isActive: true;
  faceRegistered: false;
}

type CreateAttempt = (normalizedName: string) => Promise<EmployeeManagementRecord>;

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === [...expectedKeys].sort()[index])
  );
}

export function normalizeEmployeeName(name: unknown): string {
  if (typeof name !== "string") {
    throw new HttpError("name must be a non-empty string.", 400);
  }
  const normalizedName = name.trim();
  if (normalizedName.length === 0 || normalizedName.length > MAX_EMPLOYEE_NAME_LENGTH) {
    throw new HttpError(`name must contain 1-${MAX_EMPLOYEE_NAME_LENGTH} characters.`, 400);
  }
  return normalizedName;
}

export function nextEmployeeCode(employeeCodes: string[]): string {
  const highestEmployeeNumber = employeeCodes.reduce((highest, employeeCode) => {
    const match = EMPLOYEE_CODE_PATTERN.exec(employeeCode);
    if (!match) return highest;
    const value = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(value) ? Math.max(highest, value) : highest;
  }, 0);
  return `EMP${String(highestEmployeeNumber + 1).padStart(3, "0")}`;
}

export function buildNewEmployeeData(
  normalizedName: string,
  existingEmployeeCodes: string[],
): NewEmployeeData {
  return {
    name: normalizedName,
    employeeCode: nextEmployeeCode(existingEmployeeCodes),
    isActive: true,
    faceRegistered: false,
  };
}

export function parseCreateEmployeeRequest(body: unknown): string {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !hasExactKeys(body as Record<string, unknown>, ["name"])
  ) {
    throw new HttpError("Request body must contain only name.", 400);
  }
  return normalizeEmployeeName((body as Record<string, unknown>).name);
}

export function parseFaceRegistrationCompleteRequest(body: unknown): number {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !hasExactKeys(body as Record<string, unknown>, ["sessionId"])
  ) {
    throw new HttpError("Request body must contain only sessionId.", 400);
  }
  const sessionId = (body as Record<string, unknown>).sessionId;
  if (typeof sessionId !== "number" || !Number.isInteger(sessionId) || sessionId <= 0) {
    throw new HttpError("sessionId must be a positive integer.", 400);
  }
  return sessionId;
}

export function toSafeEmployee(record: EmployeeManagementRecord): EmployeeManagementRecord {
  return {
    id: record.id,
    employeeCode: record.employeeCode,
    name: record.name,
    isActive: record.isActive,
    faceRegistered: record.faceRegistered,
  };
}

function isRetryableCreateError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "P2002" || error.code === "P2034";
}

export async function createEmployeeWithRetry(
  name: unknown,
  createAttempt: CreateAttempt,
  retryable: (error: unknown) => boolean = isRetryableCreateError,
): Promise<EmployeeManagementRecord> {
  const normalizedName = normalizeEmployeeName(name);
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return toSafeEmployee(await createAttempt(normalizedName));
    } catch (error: unknown) {
      if (attempt === MAX_CREATE_ATTEMPTS || !retryable(error)) throw error;
    }
  }
  throw new Error("Employee creation retry loop exited unexpectedly.");
}

export async function createEmployee(name: unknown): Promise<EmployeeManagementRecord> {
  return createEmployeeWithRetry(name, (normalizedName) =>
    prisma.$transaction(
      async (transaction) => {
        const existingEmployees = await transaction.employee.findMany({
          select: { employeeCode: true },
        });
        const data = buildNewEmployeeData(
          normalizedName,
          existingEmployees.map((employee) => employee.employeeCode),
        );
        return transaction.employee.create({
          data,
          select: {
            id: true,
            employeeCode: true,
            name: true,
            isActive: true,
            faceRegistered: true,
          },
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function completeFaceRegistrationWithUpdate(
  requestBody: unknown,
  completeAttempt: (sessionId: number) => Promise<EmployeeManagementRecord | null>,
): Promise<EmployeeManagementRecord> {
  const sessionId = parseFaceRegistrationCompleteRequest(requestBody);
  const employee = await completeAttempt(sessionId);
  if (employee === null || !employee.isActive) {
    throw new HttpError("Employee is unknown or inactive.", 401);
  }
  return toSafeEmployee({ ...employee, faceRegistered: true });
}

export async function completeFaceRegistration(
  requestBody: unknown,
): Promise<EmployeeManagementRecord> {
  return completeFaceRegistrationWithUpdate(requestBody, (sessionId) =>
    prisma.$transaction(async (transaction) => {
      const now = new Date();
      const session = await transaction.kioskSession.findUnique({ where: { id: sessionId } });
      if (
        !session ||
        session.machineId !== PILOT_KIOSK_MACHINE_ID ||
        session.type !== "FACE_REGISTRATION" ||
        session.status !== "ACTIVE" ||
        session.expiresAt <= now ||
        session.employeeId === null
      ) {
        if (session?.status === "ACTIVE" && session.expiresAt <= now) {
          await transaction.kioskSession.update({
            where: { id: session.id },
            data: { status: "EXPIRED" },
          });
        }
        throw new HttpError("A valid active face-registration session is required.", 403);
      }
      const updateResult = await transaction.employee.updateMany({
        where: { id: session.employeeId, isActive: true },
        data: { faceRegistered: true },
      });
      if (updateResult.count !== 1) return null;
      await transaction.kioskSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: now },
      });
      return transaction.employee.findUnique({
        where: { id: session.employeeId },
        select: {
          id: true,
          employeeCode: true,
          name: true,
          isActive: true,
          faceRegistered: true,
        },
      });
    }),
  );
}
