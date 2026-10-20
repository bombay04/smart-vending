export function employeeValidationFailureState(error) {
  if (error.rejected) return "NO_MATCH";
  if (error.status === 403) return "AUTHORIZATION_FAILED";
  return "VALIDATION_UNAVAILABLE";
}
