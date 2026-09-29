import type { KioskSession } from "./api/kiosk-session";

export type KioskSessionAction =
  | "STAY"
  | "EXIT_STAFF"
  | "START_RESTOCK_AUTH"
  | "START_FACE_REGISTRATION"
  | "PROCESS_DRAFT_DELETE"
  | "PROCESS_OFFBOARDING";

export function decideKioskSessionAction(input: {
  session: KioskSession | null;
  isSafeIdle: boolean;
  currentMode: "customer" | "employee-auth" | "restock" | "face-registration";
  acceptedSessionIds: Set<number>;
  workflowCompleted: boolean;
}): KioskSessionAction;
