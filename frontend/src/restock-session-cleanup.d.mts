export function cancelRestockSessionAndCleanup(input: {
  sessionId: number;
  cancelSession(sessionId: number): Promise<unknown>;
  clearLocalState(): void;
}): Promise<void>;
