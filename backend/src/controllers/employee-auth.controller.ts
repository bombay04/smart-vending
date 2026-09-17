import type { NextFunction, Request, Response } from "express";
import { authenticateMockEmployee } from "../services/employee-auth.service";

export async function mockAuthenticateEmployee(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const employeeCode: unknown = request.body?.employeeCode;

  if (typeof employeeCode !== "string" || employeeCode.trim().length === 0) {
    response.status(400).json({ error: "employeeCode must be a non-empty string." });
    return;
  }

  try {
    const employee = await authenticateMockEmployee(employeeCode);
    response.status(200).json({ employee });
  } catch (error: unknown) {
    next(error);
  }
}
