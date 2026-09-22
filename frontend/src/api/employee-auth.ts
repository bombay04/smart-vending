import { API_BASE_URL } from "../config/api";
import type { AuthenticatedEmployee } from "../types/employee";

const mockEmployeeAuthUrl = `${API_BASE_URL}/api/v1/employees/auth/mock`;
const faceEmployeeAuthUrl = `${API_BASE_URL}/api/v1/employees/auth/face`;
const faceRegistrationValidationUrl = `${API_BASE_URL}/api/v1/employees/face-registration/validate`;

export class EmployeeValidationError extends Error {
  constructor(readonly rejected: boolean) {
    super(rejected ? "Employee access is not active." : "Employee validation is unavailable.");
    this.name = "EmployeeValidationError";
  }
}

function isAuthenticatedEmployee(value: unknown): value is AuthenticatedEmployee {
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
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  const normalizedEmployeeCode = employeeCode.trim().toUpperCase();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ employeeCode: normalizedEmployeeCode }),
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
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  return postEmployeeCode(faceEmployeeAuthUrl, employeeCode, signal);
}

export function validateEmployeeForFaceRegistration(
  employeeCode: string,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  return postEmployeeCode(faceRegistrationValidationUrl, employeeCode, signal);
}

export async function authenticateMockEmployee(
  employeeCode: string,
  signal?: AbortSignal,
): Promise<AuthenticatedEmployee> {
  return postEmployeeCode(mockEmployeeAuthUrl, employeeCode, signal);
}
