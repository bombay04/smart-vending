import type { NextFunction, Request, Response } from "express";
import {
  authenticateEmployee,
  listEmployeesForFaceRegistration,
} from "../services/employee-auth.service";
import {
  completeFaceRegistration,
  createEmployee,
  parseCreateEmployeeRequest,
} from "../services/employee-management.service";

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
export const validateEmployeeForFaceRegistration = authenticateEmployeeRequest;

export async function getEmployeesForFaceRegistration(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employees = await listEmployeesForFaceRegistration();
    response.status(200).json({ employees });
  } catch (error: unknown) {
    next(error);
  }
}

export async function createEmployeeRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const name = parseCreateEmployeeRequest(request.body);
    const employee = await createEmployee(name);
    response.status(201).json({ employee });
  } catch (error: unknown) {
    next(error);
  }
}

export async function completeFaceRegistrationRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employee = await completeFaceRegistration(request.body);
    response.status(200).json({ employee });
  } catch (error: unknown) {
    next(error);
  }
}
