import { Router } from "express";
import {
  faceAuthenticateEmployee,
  mockAuthenticateEmployee,
  validateEmployeeForFaceRegistration,
} from "../controllers/employee-auth.controller";

const employeeRouter = Router();

employeeRouter.post("/auth/face", faceAuthenticateEmployee);
employeeRouter.post("/auth/mock", mockAuthenticateEmployee);
employeeRouter.post("/face-registration/validate", validateEmployeeForFaceRegistration);

export default employeeRouter;
