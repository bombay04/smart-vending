import assert from "node:assert/strict";
import test from "node:test";
import {
  HARDWARE_ALERT_MAX_ATTEMPTS,
  hardwareAlertFailureDisposition,
  InvalidHeartbeatError,
  isHardwareAlertRetryKeyExpired,
  isHeartbeatStale,
  LINE_RETRY_KEY_VALIDITY_MS,
  parseHeartbeat,
} from "./hardware-monitoring";
import {
  EVALUATOR_CONTINUITY_MAX_GAP_MS,
  OFFLINE_CONFIRMATION_MS,
  OFFLINE_THRESHOLD_MS,
  offlineEvaluationDecision,
} from "./hardware-monitoring.service";

const NOW = new Date("2026-10-26T12:00:00.000Z");

function heartbeat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    machineId: "PILOT_KIOSK",
    sequence: 7,
    observedAt: "2026-10-26T11:59:59.000Z",
    ...overrides,
  };
}

test("heartbeat accepts only the offline-monitoring envelope", () => {
  const parsed = parseHeartbeat(heartbeat(), NOW);
  assert.equal(parsed.machineId, "PILOT_KIOSK");
  assert.equal(parsed.sequence, 7n);
  assert.deepEqual(Object.keys(parsed).sort(), ["machineId", "observedAt", "sequence", "version"]);
});

test("heartbeat validates identity, ordering fields, and future clock skew", () => {
  for (const value of [
    heartbeat({ version: 2 }),
    heartbeat({ machineId: "bad machine" }),
    heartbeat({ sequence: 0 }),
    heartbeat({ observedAt: "invalid" }),
    heartbeat({ observedAt: "2026-10-26T12:02:01.000Z" }),
    heartbeat({ esp32: { status: "HEALTHY" } }),
  ]) {
    assert.throws(() => parseHeartbeat(value, NOW), InvalidHeartbeatError);
  }
});

test("duplicate and out-of-order heartbeat observations are stale", () => {
  assert.equal(
    isHeartbeatStale(7n, new Date("2026-10-26T11:59:59.000Z"), {
      sequence: 7n,
      observedAt: NOW,
    }),
    true,
  );
  assert.equal(
    isHeartbeatStale(7n, new Date("2026-10-26T11:59:59.000Z"), {
      sequence: 8n,
      observedAt: NOW,
    }),
    false,
  );
});

test("offline transition requires two continuous evaluator stages", () => {
  const staleHeartbeat = new Date(NOW.getTime() - OFFLINE_THRESHOLD_MS);
  assert.equal(
    offlineEvaluationDecision(
      { lastHeartbeatAt: staleHeartbeat, offlineCandidateSince: null, lastEvaluatedAt: NOW },
      NOW,
    ),
    "START_CONFIRMATION",
  );
  assert.equal(
    offlineEvaluationDecision(
      {
        lastHeartbeatAt: staleHeartbeat,
        offlineCandidateSince: new Date(NOW.getTime() - OFFLINE_CONFIRMATION_MS + 1),
        lastEvaluatedAt: new Date(NOW.getTime() - 60_000),
      },
      NOW,
    ),
    "WAIT",
  );
  assert.equal(
    offlineEvaluationDecision(
      {
        lastHeartbeatAt: staleHeartbeat,
        offlineCandidateSince: new Date(NOW.getTime() - OFFLINE_CONFIRMATION_MS),
        lastEvaluatedAt: new Date(NOW.getTime() - 60_000),
      },
      NOW,
    ),
    "OFFLINE",
  );
});

test("fresh heartbeat cancels confirmation and cloud downtime restarts it", () => {
  assert.equal(
    offlineEvaluationDecision(
      {
        lastHeartbeatAt: new Date(NOW.getTime() - OFFLINE_THRESHOLD_MS + 1),
        offlineCandidateSince: new Date(NOW.getTime() - OFFLINE_CONFIRMATION_MS),
        lastEvaluatedAt: new Date(NOW.getTime() - 60_000),
      },
      NOW,
    ),
    "FRESH",
  );
  assert.equal(
    offlineEvaluationDecision(
      {
        lastHeartbeatAt: new Date(NOW.getTime() - OFFLINE_THRESHOLD_MS),
        offlineCandidateSince: new Date(NOW.getTime() - OFFLINE_CONFIRMATION_MS),
        lastEvaluatedAt: new Date(NOW.getTime() - EVALUATOR_CONTINUITY_MAX_GAP_MS - 1),
      },
      NOW,
    ),
    "START_CONFIRMATION",
  );
});

test("retry key expires at 24 hours and attempt limit enters manual review", () => {
  const created = new Date(NOW.getTime() - LINE_RETRY_KEY_VALIDITY_MS);
  assert.equal(isHardwareAlertRetryKeyExpired(created, NOW), true);
  assert.equal(
    hardwareAlertFailureDisposition({
      retryable: true,
      attemptCount: 1,
      retryKeyCreatedAt: new Date(NOW.getTime() - 1_000),
      now: NOW,
    }),
    "FAILED",
  );
  assert.equal(
    hardwareAlertFailureDisposition({
      retryable: true,
      attemptCount: HARDWARE_ALERT_MAX_ATTEMPTS,
      retryKeyCreatedAt: new Date(NOW.getTime() - 1_000),
      now: NOW,
    }),
    "MANUAL_REVIEW",
  );
  assert.equal(
    hardwareAlertFailureDisposition({
      retryable: false,
      attemptCount: 1,
      retryKeyCreatedAt: new Date(NOW.getTime() - 1_000),
      now: NOW,
    }),
    "MANUAL_REVIEW",
  );
});
