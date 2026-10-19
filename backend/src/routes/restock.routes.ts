import { Router } from "express";
import { authorizeRestockUnlock, mockRestock } from "../controllers/restock.controller";

const restockRouter = Router();

restockRouter.post("/mock", mockRestock);
restockRouter.post("/unlock-grant", authorizeRestockUnlock);

export default restockRouter;
