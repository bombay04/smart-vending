export async function cancelFaceRegistrationSessionAndCleanup({
  sessionId,
  cancelSession,
  clearLocalState,
}) {
  await cancelSession(sessionId);
  clearLocalState();
}
