import { PI_UNLOCK_BASE_URL } from "../config/api";
import type { HardwareSlotStatus, HardwareStatusResponse } from "../types/hardware";

const hardwareStatusUrl = `${PI_UNLOCK_BASE_URL}/hardware/status`;

function isHardwareSlotStatus(value: unknown): value is HardwareSlotStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const slot = value as Record<string, unknown>;

  return (
    typeof slot.slotNumber === "number" &&
    [1, 2, 3].includes(slot.slotNumber) &&
    typeof slot.productPresent === "boolean" &&
    typeof slot.doorClosed === "boolean"
  );
}

function parseHardwareStatus(value: unknown): HardwareStatusResponse {
  if (typeof value !== "object" || value === null) {
    throw new Error("Hardware status response is invalid.");
  }

  const response = value as Record<string, unknown>;
  if (response.status !== "ok" || !Array.isArray(response.slots)) {
    throw new Error("Hardware status response is invalid.");
  }

  const slots = response.slots;
  const slotNumbers = slots.map((slot) =>
    isHardwareSlotStatus(slot) ? slot.slotNumber : null,
  );

  if (
    slots.length !== 3 ||
    !slots.every(isHardwareSlotStatus) ||
    ![1, 2, 3].every((slotNumber) => slotNumbers.includes(slotNumber))
  ) {
    throw new Error("Hardware status response is incomplete.");
  }

  return {
    status: "ok",
    slots: [...slots].sort((first, second) => first.slotNumber - second.slotNumber),
  };
}

export async function fetchHardwareStatus(signal?: AbortSignal): Promise<HardwareStatusResponse> {
  const response = await fetch(hardwareStatusUrl, { signal });

  if (!response.ok) {
    throw new Error("Hardware status request failed.");
  }

  return parseHardwareStatus((await response.json()) as unknown);
}
