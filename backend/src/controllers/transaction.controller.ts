import type { NextFunction, Request, Response } from "express";
import { parseOmiseWebhookChargeId, verifyOmiseWebhookSignature } from "../payments/omise-webhook";
import {
  createPromptPayPayment,
  getPaymentStatus,
  reconcileWebhookCharge,
} from "../services/transaction.service";

type RequestWithRawBody = Request & { rawBody?: Buffer };

export async function createPayment(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const slotNumber: unknown = request.body?.slotNumber;
  if (typeof slotNumber !== "number" || !Number.isInteger(slotNumber)) {
    response.status(400).json({ error: "slotNumber must be an integer." });
    return;
  }

  try {
    response.status(201).json({ data: await createPromptPayPayment(slotNumber) });
  } catch (error: unknown) {
    next(error);
  }
}

export async function paymentStatus(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const transactionId = Number(request.params.transactionId);
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) {
    response.status(400).json({ error: "transactionId must be a positive integer." });
    return;
  }

  try {
    response.json({ data: await getPaymentStatus(transactionId) });
  } catch (error: unknown) {
    next(error);
  }
}

export async function omiseWebhook(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const webhookSecret = process.env.OMISE_WEBHOOK_SECRET;
    if (webhookSecret) {
      verifyOmiseWebhookSignature(
        (request as RequestWithRawBody).rawBody ?? Buffer.alloc(0),
        request.header("Omise-Signature"),
        request.header("Omise-Signature-Timestamp"),
        webhookSecret,
      );
    }

    const providerChargeId = parseOmiseWebhookChargeId(request.body);
    if (!providerChargeId) {
      response.status(200).json({ received: true, processed: false });
      return;
    }

    const result = await reconcileWebhookCharge(providerChargeId);
    response.status(200).json({ received: true, ...result });
  } catch (error: unknown) {
    next(error);
  }
}
