export function normalizeEmployeeNameForComparison(name) {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const EMPLOYEE_NAME_CHARACTERS = /^[\p{L}\p{M}\p{N} '-]+$/u;

export function isEmployeeNameCharacterValid(name) {
  const normalizedName = name.normalize("NFKC");
  return (
    normalizedName.trim().length > 0 &&
    EMPLOYEE_NAME_CHARACTERS.test(normalizedName)
  );
}

export function isDuplicateEmployeeName(name, employees) {
  const comparisonName = normalizeEmployeeNameForComparison(name);
  return (
    comparisonName.length > 0 &&
    employees.some(
      (employee) =>
        normalizeEmployeeNameForComparison(employee.name) === comparisonName,
    )
  );
}
