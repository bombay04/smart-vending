import assert from "node:assert/strict";
import test from "node:test";
import {
  getKioskSessionSecondsRemaining,
  KIOSK_SESSION_MAX_SECONDS,
} from "../src/kiosk-session-countdown.mjs";

function session({ serverNow, expiresAt, receivedAt = 1_000 }) {
  return {
    expiresAt,
    countdownServerNow: serverNow,
    countdownReceivedAtMs: receivedAt,
  };
}

test("restock countdown starts at 300 despite a client clock skew", () => {
  const active = session({
    serverNow: "2026-10-19T03:00:00.000Z",
    expiresAt: "2026-10-19T03:05:00.000Z",
  });
  assert.equal(KIOSK_SESSION_MAX_SECONDS, 300);
  assert.equal(getKioskSessionSecondsRemaining(active, 1_000), 300);
  assert.equal(getKioskSessionSecondsRemaining(active, 7_000), 294);
});

test("face-registration countdown is capped and reaches zero", () => {
  const skewed = session({
    serverNow: "2026-10-19T03:00:00.000Z",
    expiresAt: "2026-10-19T03:05:06.000Z",
  });
  assert.equal(getKioskSessionSecondsRemaining(skewed, 1_000), 300);
  assert.equal(getKioskSessionSecondsRemaining(skewed, 301_000), 0);
});

test("a replacement session uses its own monotonic receipt boundary", () => {
  const replacement = session({
    serverNow: "2026-10-19T04:00:00.000Z",
    expiresAt: "2026-10-19T04:05:00.000Z",
    receivedAt: 50_000,
  });
  assert.equal(getKioskSessionSecondsRemaining(replacement, 50_000), 300);
  assert.equal(getKioskSessionSecondsRemaining(replacement, 51_000), 299);
});
