import { Router } from "express";
import { createPayment, omiseWebhook, paymentStatus } from "../controllers/transaction.controller";

const transactionRouter = Router();

transactionRouter.post("/payments", createPayment);
transactionRouter.get("/:transactionId/payment-status", paymentStatus);
transactionRouter.post("/omise/webhook", omiseWebhook);

export default transactionRouter;
