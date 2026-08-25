import { Router } from "express";
import { mockRestock } from "../controllers/restock.controller";

const restockRouter = Router();

restockRouter.post("/mock", mockRestock);

export default restockRouter;
