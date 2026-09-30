import { Router } from "express";
import {
  cancelSession,
  completeSession,
  currentKioskSession,
  startFaceRegistrationSession,
  startRestockSession,
  completeOffboardingSession,
  submitDraftDeleteResult,
} from "../controllers/kiosk-session.controller";

const kioskSessionRouter = Router();
kioskSessionRouter.get("/current", currentKioskSession);
kioskSessionRouter.post("/restock", startRestockSession);
kioskSessionRouter.post("/face-registration", startFaceRegistrationSession);
kioskSessionRouter.post("/:sessionId/draft-delete-result", submitDraftDeleteResult);
kioskSessionRouter.post("/:sessionId/offboarding-complete", completeOffboardingSession);
kioskSessionRouter.post("/:sessionId/complete", completeSession);
kioskSessionRouter.post("/:sessionId/cancel", cancelSession);

export default kioskSessionRouter;
