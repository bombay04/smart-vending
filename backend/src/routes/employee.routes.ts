import { Router } from "express";
import { mockAuthenticateEmployee } from "../controllers/employee-auth.controller";

const employeeRouter = Router();

employeeRouter.post("/auth/mock", mockAuthenticateEmployee);

export default employeeRouter;
