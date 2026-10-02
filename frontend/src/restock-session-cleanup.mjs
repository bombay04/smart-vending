export async function cancelRestockSessionAndCleanup({
  sessionId,
  cancelSession,
  clearLocalState,
}) {
  await cancelSession(sessionId);
  clearLocalState();
}
