export function normalizeEmployeeNameForComparison(name: string): string;

export function isEmployeeNameCharacterValid(name: string): boolean;

export function isDuplicateEmployeeName(
  name: string,
  employees: ReadonlyArray<{ name: string }>,
): boolean;
