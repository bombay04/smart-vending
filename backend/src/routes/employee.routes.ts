import { Router } from "express";
import {
  faceAuthenticateEmployee,
  mockAuthenticateEmployee,
} from "../controllers/employee-auth.controller";

const employeeRouter = Router();

employeeRouter.post("/auth/face", faceAuthenticateEmployee);
employeeRouter.post("/auth/mock", mockAuthenticateEmployee);

export default employeeRouter;
