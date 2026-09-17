import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/http-error";

export async function authenticateMockEmployee(employeeCode: string) {
  const employee = await prisma.employee.findUnique({
    where: { employeeCode },
    select: {
      id: true,
      name: true,
      employeeCode: true,
      isActive: true,
    },
  });

  if (!employee || !employee.isActive) {
    throw new HttpError("Invalid employee code.", 401);
  }

  return {
    id: employee.id,
    name: employee.name,
    employeeCode: employee.employeeCode,
  };
}
