export type EmployeeValidationFailureState =
  | "NO_MATCH"
  | "AUTHORIZATION_FAILED"
  | "VALIDATION_UNAVAILABLE";

export function employeeValidationFailureState(error: {
  rejected: boolean;
  status: number | null;
}): EmployeeValidationFailureState;
