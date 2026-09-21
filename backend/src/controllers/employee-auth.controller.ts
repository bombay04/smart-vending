import type { NextFunction, Request, Response } from "express";
import { authenticateEmployee } from "../services/employee-auth.service";

async function authenticateEmployeeRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const employeeCode: unknown = request.body?.employeeCode;

  try {
    const employee = await authenticateEmployee(employeeCode);
    response.status(200).json({ employee });
  } catch (error: unknown) {
    next(error);
  }
}

export const faceAuthenticateEmployee = authenticateEmployeeRequest;
export const mockAuthenticateEmployee = authenticateEmployeeRequest;
