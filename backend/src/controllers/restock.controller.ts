import type { NextFunction, Request, Response } from "express";
import { createMockRestock } from "../services/restock.service";

export async function mockRestock(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const employeeId: unknown = request.body?.employeeId;

  if (typeof employeeId !== "number" || !Number.isInteger(employeeId) || employeeId <= 0) {
    response.status(400).json({ error: "employeeId must be a positive integer." });
    return;
  }

  try {
    const restock = await createMockRestock(employeeId);
    response.status(201).json({ data: restock });
  } catch (error: unknown) {
    next(error);
  }
}
