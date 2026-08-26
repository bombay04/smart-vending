import type { Slot, SlotResponse } from "../types/slot";
import { API_BASE_URL } from "../config/api";

const slotsUrl = `${API_BASE_URL}/api/v1/slots`;

export async function fetchSlots(): Promise<Slot[]> {
  const response = await fetch(slotsUrl);

  if (!response.ok) {
    throw new Error("Failed to fetch slots.");
  }

  const responseData = (await response.json()) as SlotResponse;

  return responseData.data;
}
