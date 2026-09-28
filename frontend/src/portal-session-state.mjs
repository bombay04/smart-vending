export function getPortalSessionState(session, managedType) {
  if (session === null) return "IDLE";
  return session.type === managedType ? "OWN_SESSION" : "KIOSK_BUSY";
}
