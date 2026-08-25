import { Router } from "express";
import { listSlots } from "../controllers/slot.controller";

const slotRouter = Router();

slotRouter.get("/", listSlots);

export default slotRouter;
