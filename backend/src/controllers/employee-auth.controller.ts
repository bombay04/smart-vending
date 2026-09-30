import type { NextFunction, Request, Response } from "express";
import {
  authenticateEmployee,
  listEmployeesForFaceRegistration,
} from "../services/employee-auth.service";
import {
  completeFaceRegistration,
  createEmployee,
  deleteEmployee,
  parseCreateEmployeeRequest,
  updateEmployee,
} from "../services/employee-management.service";
import {
  requireEmptyLifecycleBody,
  startDraftDelete,
  startOffboarding,
} from "../services/employee-lifecycle.service";
import { requireActiveKioskSession } from "../services/kiosk-session.service";

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

export const mockAuthenticateEmployee = authenticateEmployeeRequest;
export const validateEmployeeForFaceRegistration = authenticateEmployeeRequest;

export async function faceAuthenticateEmployeeForSession(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await requireActiveKioskSession(request.body?.sessionId, "RESTOCK_AUTH");
    const employee = await authenticateEmployee(request.body?.employeeCode);
    response.status(200).json({ employee });
  } catch (error: unknown) {
    next(error);
  }
}

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

export async function updateEmployeeRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employee = await updateEmployee(request.params.employeeId, request.body);
    response.status(200).json({ employee });
  } catch (error: unknown) {
    next(error);
  }
}

export async function deleteEmployeeRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteEmployee(request.params.employeeId);
    response.status(204).send();
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

export async function startDraftDeleteRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    requireEmptyLifecycleBody(request.body);
    response.status(201).json({ session: await startDraftDelete(request.params.employeeId) });
  } catch (error: unknown) {
    next(error);
  }
}

export async function startOffboardingRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    requireEmptyLifecycleBody(request.body);
    response.status(201).json({ session: await startOffboarding(request.params.employeeId) });
  } catch (error: unknown) {
    next(error);
  }
}
