import { Router } from "express";
import { listManagedSlots, patchManagedSlot } from "../controllers/admin-slot.controller";

const adminSlotRouter = Router();

adminSlotRouter.get("/", listManagedSlots);
adminSlotRouter.patch("/:slotNumber", patchManagedSlot);

export default adminSlotRouter;
