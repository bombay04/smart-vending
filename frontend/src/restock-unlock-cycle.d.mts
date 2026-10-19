export type RestockUnlockCycleStage =
  "REQUESTING" | "WAITING_OPEN" | "WAITING_CLOSED" | "ASSISTANCE";
export interface RestockUnlockCycle {
  stage: RestockUnlockCycleStage;
  startedAtMs: number;
}
export interface DoorObservation {
  slotNumber: number;
  doorClosed: boolean;
}
export const RESTOCK_DOOR_OPEN_TIMEOUT_MS: number;
export function beginRestockUnlock(
  cycles: Map<number, RestockUnlockCycle>,
  slotNumber: number,
  nowMs: number,
): Map<number, RestockUnlockCycle>;
export function markRestockUnlockSent(
  cycles: Map<number, RestockUnlockCycle>,
  slotNumber: number,
  nowMs: number,
): Map<number, RestockUnlockCycle>;
export function clearRestockUnlockRequest(
  cycles: Map<number, RestockUnlockCycle>,
  slotNumber: number,
): Map<number, RestockUnlockCycle>;
export function applyRestockDoorObservations(
  cycles: Map<number, RestockUnlockCycle>,
  slots: DoorObservation[],
  nowMs: number,
  openTimeoutMs?: number,
): Map<number, RestockUnlockCycle>;
