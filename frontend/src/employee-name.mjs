export function normalizeEmployeeNameForComparison(name) {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
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
