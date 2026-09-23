import { Router } from "express";
import {
  completeFaceRegistrationRequest,
  createEmployeeRequest,
  faceAuthenticateEmployee,
  getEmployeesForFaceRegistration,
  mockAuthenticateEmployee,
  validateEmployeeForFaceRegistration,
} from "../controllers/employee-auth.controller";

const employeeRouter = Router();

employeeRouter.post("/", createEmployeeRequest);
employeeRouter.post("/auth/face", faceAuthenticateEmployee);
employeeRouter.post("/auth/mock", mockAuthenticateEmployee);
employeeRouter.get("/face-registration", getEmployeesForFaceRegistration);
employeeRouter.post("/face-registration/complete", completeFaceRegistrationRequest);
employeeRouter.post("/face-registration/validate", validateEmployeeForFaceRegistration);

export default employeeRouter;
