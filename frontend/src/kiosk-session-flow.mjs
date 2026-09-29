export function decideKioskSessionAction({
  session,
  isSafeIdle,
  currentMode,
  acceptedSessionIds,
  workflowCompleted,
}) {
  if (session === null) {
    return currentMode !== "customer" && !workflowCompleted
      ? "EXIT_STAFF"
      : "STAY";
  }
  if (
    !isSafeIdle ||
    currentMode !== "customer" ||
    acceptedSessionIds.has(session.id)
  ) {
    return "STAY";
  }
  if (session.type === "RESTOCK_AUTH") return "START_RESTOCK_AUTH";
  if (session.type === "FACE_REGISTRATION" && session.employee !== null) {
    return "START_FACE_REGISTRATION";
  }
  if (session.type === "EMPLOYEE_DRAFT_DELETE" && session.employee !== null) {
    return "PROCESS_DRAFT_DELETE";
  }
  if (session.type === "EMPLOYEE_OFFBOARDING" && session.employee !== null) {
    return "PROCESS_OFFBOARDING";
  }
  return "STAY";
}
