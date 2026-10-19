export const KIOSK_SESSION_MAX_SECONDS = 300;

export function getKioskSessionSecondsRemaining(
  session,
  monotonicNowMs = performance.now(),
) {
  if (!session) return 0;

  const expiresAtMs = Date.parse(session.expiresAt);
  const serverNowMs = Date.parse(session.countdownServerNow);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(serverNowMs)) return 0;

  const authoritativeRemainingAtReceipt = Math.min(
    KIOSK_SESSION_MAX_SECONDS * 1000,
    Math.max(0, expiresAtMs - serverNowMs),
  );
  const elapsedSinceReceipt = Math.max(
    0,
    monotonicNowMs - session.countdownReceivedAtMs,
  );

  return Math.min(
    KIOSK_SESSION_MAX_SECONDS,
    Math.max(
      0,
      Math.ceil((authoritativeRemainingAtReceipt - elapsedSinceReceipt) / 1000),
    ),
  );
}
