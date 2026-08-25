import type { NextFunction, Request, Response } from "express";
import { createMockPurchase } from "../services/transaction.service";

export async function mockPurchase(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const slotNumber: unknown = request.body?.slotNumber;

  if (typeof slotNumber !== "number" || ![1, 2, 3].includes(slotNumber)) {
    response.status(400).json({ error: "slotNumber must be 1, 2, or 3." });
    return;
  }

  try {
    const purchase = await createMockPurchase(slotNumber);
    response.status(201).json({ data: purchase });
  } catch (error: unknown) {
    next(error);
  }
}
