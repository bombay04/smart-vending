import type { NextFunction, Request, Response } from "express";
import { getSlots } from "../services/slot.service";

export async function listSlots(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  void request;

  try {
    const slots = await getSlots();

    response.status(200).json({ data: slots });
  } catch (error: unknown) {
    next(error);
  }
}
