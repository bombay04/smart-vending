import { Router } from "express";
import {
  completeFaceRegistrationRequest,
  createEmployeeRequest,
  deleteEmployeeRequest,
  faceAuthenticateEmployeeForSession,
  getEmployeesForFaceRegistration,
  mockAuthenticateEmployee,
  updateEmployeeRequest,
  validateEmployeeForFaceRegistration,
  startDraftDeleteRequest,
  startOffboardingRequest,
} from "../controllers/employee-auth.controller";

export function createEmployeeRouter(nodeEnvironment = process.env.NODE_ENV): Router {
  const employeeRouter = Router();

  employeeRouter.post("/", createEmployeeRequest);
  employeeRouter.post("/auth/face", faceAuthenticateEmployeeForSession);
  if (nodeEnvironment !== "production") {
    employeeRouter.post("/auth/mock", mockAuthenticateEmployee);
  }
  employeeRouter.get("/face-registration", getEmployeesForFaceRegistration);
  employeeRouter.post("/face-registration/complete", completeFaceRegistrationRequest);
  employeeRouter.post("/face-registration/validate", validateEmployeeForFaceRegistration);
  employeeRouter.patch("/:employeeId", updateEmployeeRequest);
  employeeRouter.post("/:employeeId/draft-delete", startDraftDeleteRequest);
  employeeRouter.post("/:employeeId/offboard", startOffboardingRequest);
  employeeRouter.delete("/:employeeId", deleteEmployeeRequest);

  return employeeRouter;
}

const employeeRouter = createEmployeeRouter();

export default employeeRouter;
