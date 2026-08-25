import { Router } from "express";
import { mockPurchase } from "../controllers/transaction.controller";

const transactionRouter = Router();

transactionRouter.post("/mock-purchase", mockPurchase);

export default transactionRouter;
