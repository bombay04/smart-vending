import { API_BASE_URL } from "../config/api";
import type {
  AuthenticatedEmployee,
  RegistrationEmployee,
} from "../types/employee";
import { isKioskSession, type KioskSession } from "./kiosk-session";

const mockEmployeeAuthUrl = `${API_BASE_URL}/api/v1/employees/auth/mock`;
const faceEmployeeAuthUrl = `${API_BASE_URL}/api/v1/employees/auth/face`;
const faceRegistrationValidationUrl = `${API_BASE_URL}/api/v1/employees/face-registration/validate`;
const faceRegistrationEmployeesUrl = `${API_BASE_URL}/api/v1/employees/face-registration`;
const employeesUrl = `${API_BASE_URL}/api/v1/employees`;
const faceRegistrationCompleteUrl = `${API_BASE_URL}/api/v1/employees/face-registration/complete`;

export class EmployeeValidationError extends Error {
  constructor(readonly rejected: boolean) {
    super(
      rejected
        ? "Employee access is not active."
        : "Employee validation is unavailable.",
    );
    this.name = "EmployeeValidationError";
  }
}

export class EmployeeManagementError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EmployeeManagementError";
  }
}

function isAuthenticatedEmployee(
  value: unknown,
): value is AuthenticatedEmployee {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const employee = value as Record<string, unknown>;
  return (
    typeof employee.id === "number" &&
    Number.isInteger(employee.id) &&
    employee.id > 0 &&
    typeof employee.employeeCode === "string" &&
    employee.employeeCode.length > 0 &&
    typeof employee.name === "string" &&
    employee.name.length > 0
  );
}

async function postEmployeeCode(
  url: string,
  employeeCode: string,
  sessionId?: number,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  const normalizedEmployeeCode = employeeCode.trim().toUpperCase();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      sessionId === undefined
        ? { employeeCode: normalizedEmployeeCode }
        : { employeeCode: normalizedEmployeeCode, sessionId },
    ),
    signal,
  });

  if (!response.ok) {
    throw new EmployeeValidationError(response.status === 401);
  }

  let responseData: unknown;
  try {
    responseData = (await response.json()) as unknown;
  } catch {
    throw new EmployeeValidationError(false);
  }

  if (
    typeof responseData !== "object" ||
    responseData === null ||
    !("employee" in responseData) ||
    !isAuthenticatedEmployee(responseData.employee) ||
    responseData.employee.employeeCode !== normalizedEmployeeCode
  ) {
    throw new EmployeeValidationError(false);
  }

  return responseData.employee;
}

export function validateFaceAuthenticatedEmployee(
  employeeCode: string,
  sessionId: number,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  return postEmployeeCode(faceEmployeeAuthUrl, employeeCode, sessionId, signal);
}

type BasicRegistrationEmployee = AuthenticatedEmployee & {
  isActive: boolean;
  faceRegistered: boolean;
  canDeleteDraft?: boolean;
  activeCleanupType?: "EMPLOYEE_DRAFT_DELETE" | "EMPLOYEE_OFFBOARDING" | null;
};

function isRegistrationEmployee(
  value: unknown,
): value is BasicRegistrationEmployee {
  if (!isAuthenticatedEmployee(value)) {
    return false;
  }
  return (
    "isActive" in value &&
    typeof value.isActive === "boolean" &&
    "faceRegistered" in value &&
    typeof value.faceRegistered === "boolean" &&
    (!("canDeleteDraft" in value) ||
      typeof value.canDeleteDraft === "boolean") &&
    (!("activeCleanupType" in value) ||
      value.activeCleanupType === null ||
      value.activeCleanupType === "EMPLOYEE_DRAFT_DELETE" ||
      value.activeCleanupType === "EMPLOYEE_OFFBOARDING")
  );
}

export function validateEmployeeForFaceRegistration(
  employeeCode: string,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  return postEmployeeCode(
    faceRegistrationValidationUrl,
    employeeCode,
    undefined,
    signal,
  );
}

export async function fetchEmployeesForFaceRegistration(
  signal?: AbortSignal,
): Promise<RegistrationEmployee[]> {
  const response = await fetch(faceRegistrationEmployeesUrl, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new EmployeeValidationError(false);
  }

  let responseData: unknown;
  try {
    responseData = (await response.json()) as unknown;
  } catch {
    throw new EmployeeValidationError(false);
  }

  if (
    typeof responseData !== "object" ||
    responseData === null ||
    !("employees" in responseData) ||
    !Array.isArray(responseData.employees) ||
    !responseData.employees.every(isRegistrationEmployee)
  ) {
    throw new EmployeeValidationError(false);
  }

  return responseData.employees.map((employee) => ({
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    isActive: employee.isActive,
    faceRegistered: employee.faceRegistered,
    canDeleteDraft: employee.canDeleteDraft ?? !employee.faceRegistered,
    activeCleanupType: employee.activeCleanupType ?? null,
  }));
}

async function readRegistrationEmployee(
  response: Response,
): Promise<RegistrationEmployee> {
  if (!response.ok) {
    throw await readEmployeeManagementError(response);
  }
  let responseData: unknown;
  try {
    responseData = (await response.json()) as unknown;
  } catch {
    throw new EmployeeValidationError(false);
  }
  if (
    typeof responseData !== "object" ||
    responseData === null ||
    !("employee" in responseData) ||
    !isRegistrationEmployee(responseData.employee)
  ) {
    throw new EmployeeValidationError(false);
  }
  const employee = responseData.employee;
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    isActive: employee.isActive,
    faceRegistered: employee.faceRegistered,
    canDeleteDraft: employee.canDeleteDraft ?? !employee.faceRegistered,
    activeCleanupType: employee.activeCleanupType ?? null,
  };
}

async function startEmployeeLifecycle(
  employeeId: number,
  action: "draft-delete" | "offboard",
  signal?: AbortSignal,
): Promise<KioskSession> {
  const response = await fetch(`${employeesUrl}/${employeeId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (!response.ok) throw await readEmployeeManagementError(response);
  const payload = (await response.json()) as { session?: unknown };
  if (!isKioskSession(payload.session)) {
    throw new EmployeeManagementError(
      502,
      "Kiosk session response is invalid.",
    );
  }
  return payload.session;
}

export const startEmployeeDraftDelete = (
  employeeId: number,
  signal?: AbortSignal,
) => startEmployeeLifecycle(employeeId, "draft-delete", signal);

export const offboardEmployee = (employeeId: number, signal?: AbortSignal) =>
  startEmployeeLifecycle(employeeId, "offboard", signal);

async function readEmployeeManagementError(
  response: Response,
): Promise<EmployeeManagementError> {
  let message = "Employee request failed. Please try again.";
  try {
    const responseData = (await response.json()) as unknown;
    if (
      typeof responseData === "object" &&
      responseData !== null &&
      "error" in responseData &&
      typeof responseData.error === "string" &&
      responseData.error.length > 0
    ) {
      message = responseData.error;
    }
  } catch {
    // Keep the safe fallback message when the backend response is not JSON.
  }
  return new EmployeeManagementError(response.status, message);
}

export async function createEmployee(
  name: string,
  signal?: AbortSignal,
): Promise<RegistrationEmployee> {
  const response = await fetch(employeesUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
    signal,
  });
  return readRegistrationEmployee(response);
}

export async function updateEmployee(
  employeeId: number,
  updates: { name?: string; isActive?: boolean },
  signal?: AbortSignal,
): Promise<RegistrationEmployee> {
  const response = await fetch(`${employeesUrl}/${employeeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
    signal,
  });
  return readRegistrationEmployee(response);
}

export async function deleteEmployee(
  employeeId: number,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${employeesUrl}/${employeeId}`, {
    method: "DELETE",
    signal,
  });
  if (!response.ok) throw await readEmployeeManagementError(response);
}

export async function completeEmployeeFaceRegistration(
  sessionId: number,
  signal?: AbortSignal,
): Promise<RegistrationEmployee> {
  const response = await fetch(faceRegistrationCompleteUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    signal,
  });
  return readRegistrationEmployee(response);
}

export async function authenticateMockEmployee(
  employeeCode: string,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  return postEmployeeCode(mockEmployeeAuthUrl, employeeCode, undefined, signal);
}
