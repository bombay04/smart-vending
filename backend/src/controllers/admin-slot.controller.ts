import type { NextFunction, Request, Response } from "express";
import { listAdminSlots, updateAdminSlot } from "../services/admin-slot.service";

export async function listManagedSlots(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    response.status(200).json({ data: await listAdminSlots() });
  } catch (error: unknown) {
    next(error);
  }
}

export async function patchManagedSlot(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const slot = await updateAdminSlot(request.params.slotNumber, request.body);
    response.status(200).json({ data: slot });
  } catch (error: unknown) {
    next(error);
  }
}
