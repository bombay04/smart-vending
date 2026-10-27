import assert from "node:assert/strict";
import test from "node:test";
import {
  HARDWARE_HEALTH_LOOP_INTERVAL_MS,
  runHardwareHealthCycle,
  startHardwareHealthLoop,
} from "./hardware-health-loop";

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("backend health loop uses the approved thirty-second interval", () => {
  assert.equal(HARDWARE_HEALTH_LOOP_INTERVAL_MS, 30_000);
});

test("shared health cycle evaluates transitions before dispatching durable alerts", async () => {
  const calls: string[] = [];
  const result = await runHardwareHealthCycle({
    async evaluateOfflineMachines() {
      calls.push("evaluate");
      return 1;
    },
    async deliverPendingHardwareAlerts() {
      calls.push("deliver");
      return { sent: 1, failed: 0, manualReview: 0 };
    },
  });

  assert.deepEqual(calls, ["evaluate", "deliver"]);
  assert.deepEqual(result, {
    transitions: 1,
    delivery: { sent: 1, failed: 0, manualReview: 0 },
  });
});

test("a persisted recovery remains deliverable after a process restart", async () => {
  const calls: string[] = [];
  const result = await runHardwareHealthCycle({
    async evaluateOfflineMachines() {
      calls.push("evaluate-existing-state");
      return 0;
    },
    async deliverPendingHardwareAlerts() {
      calls.push("claim-persisted-event");
      return { sent: 1, failed: 0, manualReview: 0 };
    },
  });

  assert.deepEqual(calls, ["evaluate-existing-state", "claim-persisted-event"]);
  assert.equal(result.transitions, 0);
  assert.equal(result.delivery.sent, 1);
});

test("concurrent Backend and Cron cycles converge through shared durable claims", async () => {
  let offlineClaimed = false;
  let alertClaimed = false;
  const dependencies = {
    async evaluateOfflineMachines() {
      if (offlineClaimed) return 0;
      offlineClaimed = true;
      await Promise.resolve();
      return 1;
    },
    async deliverPendingHardwareAlerts() {
      if (alertClaimed) return { sent: 0, failed: 0, manualReview: 0 };
      alertClaimed = true;
      await Promise.resolve();
      return { sent: 1, failed: 0, manualReview: 0 };
    },
  };

  const [backend, cron] = await Promise.all([
    runHardwareHealthCycle(dependencies),
    runHardwareHealthCycle(dependencies),
  ]);

  assert.equal(backend.transitions + cron.transitions, 1);
  assert.equal(backend.delivery.sent + cron.delivery.sent, 1);
});

test("backend health loop never overlaps cycles and stops without accumulating work", async () => {
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  let releaseFirst!: () => void;
  const firstCycle = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const loop = startHardwareHealthLoop({
    intervalMs: 5,
    async runCycle() {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) await firstCycle;
      active -= 1;
    },
  });

  await waitFor(() => calls === 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(calls, 1);
  releaseFirst();
  await waitFor(() => calls >= 2);
  await loop.stop();
  const stoppedAt = calls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, stoppedAt);
  assert.equal(maxActive, 1);
});

test("database failure is contained and a later backend cycle recovers", async () => {
  let calls = 0;
  const errors: unknown[] = [];
  const loop = startHardwareHealthLoop({
    intervalMs: 5,
    async runCycle() {
      calls += 1;
      if (calls === 1) throw new Error("database unavailable");
    },
    onError(error) {
      errors.push(error);
    },
  });

  await waitFor(() => calls >= 2);
  await loop.stop();
  assert.equal(errors.length, 1);
  assert.match((errors[0] as Error).message, /database unavailable/);
});

test("stopping during a cycle waits for that cycle and schedules no successor", async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loop = startHardwareHealthLoop({
    intervalMs: 5,
    async runCycle() {
      calls += 1;
      await blocked;
    },
  });

  await waitFor(() => calls === 1);
  let stopped = false;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stopped, false);
  release();
  await stopping;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
});
