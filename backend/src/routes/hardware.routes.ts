import { Router } from "express";
import { receiveHardwareHeartbeat } from "../controllers/hardware.controller";

const router = Router();
router.post("/heartbeat", receiveHardwareHeartbeat);
export default router;
