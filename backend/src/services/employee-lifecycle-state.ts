import { HttpError } from "../utils/http-error";

export const EMPLOYEE_OFFBOARDED_CODE = "EMPLOYEE_OFFBOARDED";
export const EMPLOYEE_OFFBOARDED_MESSAGE = "This employee has been permanently offboarded.";

export interface EmployeeLifecycleState {
  isActive: boolean;
  offboardedAt: Date | null;
}

export type EmployeeLifecycle = "ACTIVE" | "DEACTIVATED" | "OFFBOARDED";

export function classifyEmployeeLifecycle(employee: EmployeeLifecycleState): EmployeeLifecycle {
  if (employee.offboardedAt !== null) return "OFFBOARDED";
  return employee.isActive ? "ACTIVE" : "DEACTIVATED";
}

export function isCurrentEmployee(employee: { offboardedAt: Date | null }): boolean {
  return employee.offboardedAt === null;
}

export function assertEmployeeNotOffboarded(employee: { offboardedAt?: Date | null }): void {
  if (employee.offboardedAt != null) {
    throw new HttpError(EMPLOYEE_OFFBOARDED_MESSAGE, 409, EMPLOYEE_OFFBOARDED_CODE);
  }
}
