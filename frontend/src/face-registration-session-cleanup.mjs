export async function cancelFaceRegistrationSessionAndCleanup({
  sessionId,
  cancelSession,
  clearLocalState,
}) {
  await cancelSession(sessionId);
  clearLocalState();
}

export function canCancelFaceRegistration(state) {
  return !["CAPTURING", "SYNCING", "SUCCESS"].includes(state);
}
