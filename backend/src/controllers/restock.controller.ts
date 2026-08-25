import type { Request, Response } from "express";
import { createMockRestock, MockRestockError } from "../services/restock.service";

export async function mockRestock(request: Request, response: Response): Promise<void> {
  const employeeId: unknown = request.body?.employeeId;

  if (typeof employeeId !== "number" || !Number.isInteger(employeeId) || employeeId <= 0) {
    response.status(400).json({ error: "employeeId must be a positive integer." });
    return;
  }

  try {
    const restock = await createMockRestock(employeeId);
    response.status(201).json({ data: restock });
  } catch (error: unknown) {
    if (error instanceof MockRestockError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    throw error;
  }
}
