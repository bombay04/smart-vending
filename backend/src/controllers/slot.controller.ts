import type { Request, Response } from "express";
import { getSlots } from "../services/slot.service";

export async function listSlots(request: Request, response: Response): Promise<void> {
  void request;

  const slots = await getSlots();

  response.status(200).json({ data: slots });
}
