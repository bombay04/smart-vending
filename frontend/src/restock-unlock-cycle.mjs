export const RESTOCK_DOOR_OPEN_TIMEOUT_MS = 15_000;

export function beginRestockUnlock(cycles, slotNumber, nowMs) {
  if (cycles.has(slotNumber)) return cycles;
  const next = new Map(cycles);
  next.set(slotNumber, { stage: "REQUESTING", startedAtMs: nowMs });
  return next;
}

export function markRestockUnlockSent(cycles, slotNumber, nowMs) {
  const next = new Map(cycles);
  next.set(slotNumber, { stage: "WAITING_OPEN", startedAtMs: nowMs });
  return next;
}

export function clearRestockUnlockRequest(cycles, slotNumber) {
  const next = new Map(cycles);
  next.delete(slotNumber);
  return next;
}

export function applyRestockDoorObservations(
  cycles,
  slots,
  nowMs,
  openTimeoutMs = RESTOCK_DOOR_OPEN_TIMEOUT_MS,
) {
  const next = new Map(cycles);
  for (const slot of slots) {
    const cycle = next.get(slot.slotNumber);
    if (
      !cycle ||
      cycle.stage === "REQUESTING" ||
      cycle.stage === "ASSISTANCE"
    ) {
      continue;
    }
    if (cycle.stage === "WAITING_OPEN") {
      if (!slot.doorClosed) {
        next.set(slot.slotNumber, {
          stage: "WAITING_CLOSED",
          startedAtMs: nowMs,
        });
      } else if (nowMs - cycle.startedAtMs >= openTimeoutMs) {
        next.set(slot.slotNumber, { stage: "ASSISTANCE", startedAtMs: nowMs });
      }
    } else if (cycle.stage === "WAITING_CLOSED" && slot.doorClosed) {
      next.delete(slot.slotNumber);
    }
  }
  return next;
}
