import { API_BASE_URL } from "../config/api";
import type {
  Slot,
  SlotConfigurationInput,
  SlotResponse,
} from "../types/slot";

const adminSlotsUrl = `${API_BASE_URL}/api/v1/admin/slots`;

export class AdminSlotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AdminSlotApiError";
  }
}

async function readError(response: Response) {
  try {
    return (await response.json()) as { error?: string; code?: string };
  } catch {
    return {};
  }
}

export async function fetchAdminSlots(signal?: AbortSignal): Promise<Slot[]> {
  const response = await fetch(adminSlotsUrl, { signal });
  if (!response.ok) {
    const body = await readError(response);
    throw new AdminSlotApiError(
      body.error ?? "ไม่สามารถโหลดข้อมูลช่องสินค้าได้",
      response.status,
      body.code,
    );
  }
  const slots = ((await response.json()) as SlotResponse).data;
  if (
    slots.length !== 3 ||
    slots.some((slot, index) => slot.slotNumber !== index + 1)
  ) {
    throw new AdminSlotApiError(
      "ข้อมูลช่องสินค้าทั้งสามช่องไม่ครบถ้วน",
      500,
    );
  }
  return slots;
}

export async function updateAdminSlot(
  slotNumber: number,
  configuration: SlotConfigurationInput,
): Promise<Slot> {
  const response = await fetch(`${adminSlotsUrl}/${slotNumber}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configuration),
  });
  if (!response.ok) {
    const body = await readError(response);
    throw new AdminSlotApiError(
      body.error ?? "ไม่สามารถบันทึกข้อมูลสินค้าได้",
      response.status,
      body.code,
    );
  }
  return ((await response.json()) as { data: Slot }).data;
}
