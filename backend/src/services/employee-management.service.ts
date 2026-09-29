import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";
import { PILOT_KIOSK_MACHINE_ID } from "./kiosk-session.service";

const EMPLOYEE_CODE_PATTERN = /^EMP(\d+)$/;
const MAX_EMPLOYEE_NAME_LENGTH = 120;
const MAX_CREATE_ATTEMPTS = 3;
const UNSAFE_DELETE_MESSAGE =
  "This employee has enrollment or usage history and cannot be deleted. Deactivate the employee instead.";

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
type UpdateAttempt = () => Promise<EmployeeManagementRecord>;

export interface EmployeeUpdateData {
  name?: string;
  isActive?: boolean;
}

interface EmployeeUpdateStore {
  findEmployee(employeeId: number): Promise<EmployeeManagementRecord | null>;
  countActiveFaceRegistrationSessions(employeeId: number, now: Date): Promise<number>;
  updateEmployee(employeeId: number, data: EmployeeUpdateData): Promise<EmployeeManagementRecord>;
}

interface EmployeeDeleteCandidate extends EmployeeManagementRecord {
  restockLogCount: number;
  kioskSessionCount: number;
}

interface EmployeeDeleteStore {
  findEmployee(employeeId: number): Promise<EmployeeDeleteCandidate | null>;
  deleteEmployee(employeeId: number): Promise<void>;
}

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

export function formatEmployeeCode(employeeCodeNumber: bigint): string {
  if (employeeCodeNumber <= 0n) throw new Error("Employee code number must be positive.");
  return `EMP${employeeCodeNumber.toString().padStart(3, "0")}`;
}

// Retained for deterministic unit callers; production allocation uses the
// durable PostgreSQL sequence below so deletion cannot recycle a code.
export function nextEmployeeCode(employeeCodes: string[]): string {
  const highestEmployeeNumber = employeeCodes.reduce((highest, employeeCode) => {
    const match = EMPLOYEE_CODE_PATTERN.exec(employeeCode);
    if (!match) return highest;
    const value = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(value) ? Math.max(highest, value) : highest;
  }, 0);
  return formatEmployeeCode(BigInt(highestEmployeeNumber + 1));
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

export function parseEmployeeId(employeeId: unknown): number {
  const parsed =
    typeof employeeId === "string" && /^\d+$/.test(employeeId)
      ? Number.parseInt(employeeId, 10)
      : employeeId;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError("employeeId must be a positive integer.", 400);
  }
  return parsed;
}

export function parseUpdateEmployeeRequest(body: unknown): EmployeeUpdateData {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError("Request body must contain name and/or isActive.", 400);
  }
  const request = body as Record<string, unknown>;
  const keys = Object.keys(request);
  if (keys.length === 0 || keys.some((key) => key !== "name" && key !== "isActive")) {
    throw new HttpError("Request body may contain only name and isActive.", 400);
  }

  const data: EmployeeUpdateData = {};
  if ("name" in request) data.name = normalizeEmployeeName(request.name);
  if ("isActive" in request) {
    if (typeof request.isActive !== "boolean") {
      throw new HttpError("isActive must be a boolean.", 400);
    }
    data.isActive = request.isActive;
  }
  return data;
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
        const [sequenceValue] = await transaction.$queryRaw<
          Array<{ employeeCodeNumber: bigint }>
        >`SELECT nextval('"EmployeeCodeNumber_seq"') AS "employeeCodeNumber"`;
        if (!sequenceValue) throw new Error("Employee code sequence returned no value.");
        const data: NewEmployeeData = {
          name: normalizedName,
          employeeCode: formatEmployeeCode(sequenceValue.employeeCodeNumber),
          isActive: true,
          faceRegistered: false,
        };
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

export async function updateEmployeeWithStore(
  employeeIdValue: unknown,
  body: unknown,
  store: EmployeeUpdateStore,
  now = new Date(),
): Promise<EmployeeManagementRecord> {
  const employeeId = parseEmployeeId(employeeIdValue);
  const data = parseUpdateEmployeeRequest(body);
  const employee = await store.findEmployee(employeeId);
  if (!employee) throw new HttpError("Employee not found.", 404);

  if (employee.isActive && data.isActive === false) {
    const activeRegistrationSessions = await store.countActiveFaceRegistrationSessions(
      employeeId,
      now,
    );
    if (activeRegistrationSessions > 0) {
      throw new HttpError(
        "Employee cannot be deactivated during an active face-registration session. Cancel the session first.",
        409,
      );
    }
  }

  return toSafeEmployee(await store.updateEmployee(employeeId, data));
}

export async function updateEmployeeWithConflictHandling(
  updateAttempt: UpdateAttempt,
): Promise<EmployeeManagementRecord> {
  try {
    return await updateAttempt();
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      throw new HttpError(
        "Employee update conflicted with another change. Refresh the employee directory and try again.",
        409,
      );
    }
    throw error;
  }
}

export async function updateEmployee(
  employeeIdValue: unknown,
  body: unknown,
): Promise<EmployeeManagementRecord> {
  return updateEmployeeWithConflictHandling(() =>
    prisma.$transaction(
      (transaction) =>
        updateEmployeeWithStore(employeeIdValue, body, {
          findEmployee: (employeeId) =>
            transaction.employee.findUnique({
              where: { id: employeeId },
              select: {
                id: true,
                employeeCode: true,
                name: true,
                isActive: true,
                faceRegistered: true,
              },
            }),
          countActiveFaceRegistrationSessions: (employeeId, now) =>
            transaction.kioskSession.count({
              where: {
                employeeId,
                type: "FACE_REGISTRATION",
                status: "ACTIVE",
                expiresAt: { gt: now },
              },
            }),
          updateEmployee: (employeeId, data) =>
            transaction.employee.update({
              where: { id: employeeId },
              data,
              select: {
                id: true,
                employeeCode: true,
                name: true,
                isActive: true,
                faceRegistered: true,
              },
            }),
        }),
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function deleteEmployeeWithStore(
  employeeIdValue: unknown,
  store: EmployeeDeleteStore,
): Promise<void> {
  const employeeId = parseEmployeeId(employeeIdValue);
  const employee = await store.findEmployee(employeeId);
  if (!employee) throw new HttpError("Employee not found.", 404);
  if (employee.faceRegistered || employee.restockLogCount > 0 || employee.kioskSessionCount > 0) {
    throw new HttpError(UNSAFE_DELETE_MESSAGE, 409);
  }
  await store.deleteEmployee(employeeId);
}

function isPrismaDeleteConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "P2003" || error.code === "P2034";
}

export async function deleteEmployee(employeeIdValue: unknown): Promise<void> {
  try {
    await prisma.$transaction(
      (transaction) =>
        deleteEmployeeWithStore(employeeIdValue, {
          findEmployee: async (employeeId) => {
            const employee = await transaction.employee.findUnique({
              where: { id: employeeId },
              select: {
                id: true,
                employeeCode: true,
                name: true,
                isActive: true,
                faceRegistered: true,
                _count: { select: { restockLogs: true, kioskSessions: true } },
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
              kioskSessionCount: employee._count.kioskSessions,
            };
          },
          deleteEmployee: async (employeeId) => {
            await transaction.employee.delete({ where: { id: employeeId } });
          },
        }),
      { isolationLevel: "Serializable" },
    );
  } catch (error: unknown) {
    if (isPrismaDeleteConflict(error)) throw new HttpError(UNSAFE_DELETE_MESSAGE, 409);
    throw error;
  }
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
