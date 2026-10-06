export function normalizeEmployeeNameForComparison(name: string): string;

export function isDuplicateEmployeeName(
  name: string,
  employees: ReadonlyArray<{ name: string }>,
): boolean;
