import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";

interface EmployeeAuthenticationRecord {
  id: number;
  name: string;
  employeeCode: string;
  isActive: boolean;
}

type FindEmployeeByCode = (employeeCode: string) => Promise<EmployeeAuthenticationRecord | null>;
interface EmployeeRegistrationListRecord extends EmployeeAuthenticationRecord {
  faceRegistered: boolean;
}

type ListEmployees = () => Promise<EmployeeRegistrationListRecord[]>;

export function normalizeEmployeeCode(employeeCode: unknown): string {
  if (typeof employeeCode !== "string" || employeeCode.trim().length === 0) {
    throw new HttpError("employeeCode must be a non-empty string.", 400);
  }

  return employeeCode.trim().toUpperCase();
}

export async function authenticateEmployeeWithLookup(
  employeeCode: unknown,
  findEmployeeByCode: FindEmployeeByCode,
) {
  const normalizedEmployeeCode = normalizeEmployeeCode(employeeCode);
  const employee = await findEmployeeByCode(normalizedEmployeeCode);

  if (!employee || !employee.isActive) {
    throw new HttpError("Invalid employee code.", 401);
  }

  return {
    id: employee.id,
    name: employee.name,
    employeeCode: employee.employeeCode,
  };
}

export async function authenticateEmployee(employeeCode: unknown) {
  return authenticateEmployeeWithLookup(employeeCode, (normalizedEmployeeCode) =>
    prisma.employee.findUnique({
      where: { employeeCode: normalizedEmployeeCode },
      select: {
        id: true,
        name: true,
        employeeCode: true,
        isActive: true,
      },
    }),
  );
}

export async function listEmployeesForFaceRegistrationWithLookup(listEmployees: ListEmployees) {
  const employees = await listEmployees();
  return employees.map((employee) => ({
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    isActive: employee.isActive,
    faceRegistered: employee.faceRegistered,
  }));
}

export async function listEmployeesForFaceRegistration() {
  return listEmployeesForFaceRegistrationWithLookup(() =>
    prisma.employee.findMany({
      orderBy: { employeeCode: "asc" },
      select: {
        id: true,
        employeeCode: true,
        name: true,
        isActive: true,
        faceRegistered: true,
      },
    }),
  );
}

// Retained temporarily for Task 33 development tooling. Production uses /auth/face.
export const authenticateMockEmployee = authenticateEmployee;
