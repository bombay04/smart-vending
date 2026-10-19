interface CountdownSession {
  expiresAt: string;
  countdownServerNow: string;
  countdownReceivedAtMs: number;
}

export const KIOSK_SESSION_MAX_SECONDS: number;
export function getKioskSessionSecondsRemaining(
  session: CountdownSession | null,
  monotonicNowMs?: number,
): number;
