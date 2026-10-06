export async function cancelFaceRegistrationSessionAndCleanup({
  sessionId,
  cancelSession,
  clearLocalState,
}) {
  await cancelSession(sessionId);
  clearLocalState();
}

export function canCancelFaceRegistration(state) {
  return state !== "CAPTURING" && state !== "SYNCING";
}
