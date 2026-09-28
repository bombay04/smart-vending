import type {
  KioskSession,
  KioskSessionType,
} from "./api/kiosk-session";

export type PortalSessionState = "IDLE" | "OWN_SESSION" | "KIOSK_BUSY";

export function getPortalSessionState(
  session: KioskSession | null,
  managedType: KioskSessionType,
): PortalSessionState;
