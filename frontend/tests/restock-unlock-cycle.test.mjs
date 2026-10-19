import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRestockDoorObservations,
  beginRestockUnlock,
  clearRestockUnlockRequest,
  markRestockUnlockSent,
} from "../src/restock-unlock-cycle.mjs";

test("closed to open to closed completes one slot unlock cycle", () => {
  let cycles = beginRestockUnlock(new Map(), 1, 0);
  cycles = markRestockUnlockSent(cycles, 1, 10);
  cycles = applyRestockDoorObservations(
    cycles,
    [{ slotNumber: 1, doorClosed: true }],
    100,
  );
  assert.equal(cycles.get(1).stage, "WAITING_OPEN");
  cycles = applyRestockDoorObservations(
    cycles,
    [{ slotNumber: 1, doorClosed: false }],
    200,
  );
  assert.equal(cycles.get(1).stage, "WAITING_CLOSED");
  cycles = applyRestockDoorObservations(
    cycles,
    [{ slotNumber: 1, doorClosed: true }],
    300,
  );
  assert.equal(cycles.has(1), false);
});

test("a door that never opens becomes assistance-only without retry", () => {
  let cycles = markRestockUnlockSent(new Map(), 2, 0);
  cycles = applyRestockDoorObservations(
    cycles,
    [{ slotNumber: 2, doorClosed: true }],
    15_000,
  );
  assert.equal(cycles.get(2).stage, "ASSISTANCE");
  assert.equal(beginRestockUnlock(cycles, 2, 16_000), cycles);
});

test("slot cycles are independent and failed HTTP requests can clear only their slot", () => {
  let cycles = beginRestockUnlock(new Map(), 1, 0);
  cycles = beginRestockUnlock(cycles, 2, 0);
  cycles = clearRestockUnlockRequest(cycles, 1);
  assert.equal(cycles.has(1), false);
  assert.equal(cycles.get(2).stage, "REQUESTING");
});
