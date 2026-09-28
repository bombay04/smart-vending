import { Router } from "express";
import {
  cancelSession,
  completeSession,
  currentKioskSession,
  startFaceRegistrationSession,
  startRestockSession,
} from "../controllers/kiosk-session.controller";

const kioskSessionRouter = Router();
kioskSessionRouter.get("/current", currentKioskSession);
kioskSessionRouter.post("/restock", startRestockSession);
kioskSessionRouter.post("/face-registration", startFaceRegistrationSession);
kioskSessionRouter.post("/:sessionId/complete", completeSession);
kioskSessionRouter.post("/:sessionId/cancel", cancelSession);

export default kioskSessionRouter;
