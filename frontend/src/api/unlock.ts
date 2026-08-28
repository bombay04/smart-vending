import { PI_UNLOCK_BASE_URL } from "../config/api";
import type { UnlockRequest, UnlockResponse } from "../types/unlock";

const unlockUrl = `${PI_UNLOCK_BASE_URL}/unlock`;

export async function unlockSlot(slotNumber: number): Promise<UnlockResponse> {
  const requestBody: UnlockRequest = { slotNumber };
  const response = await fetch(unlockUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorMessage = "Failed to unlock slot.";

    try {
      const errorResponse = (await response.json()) as { error?: unknown };

      if (typeof errorResponse.error === "string") {
        errorMessage = errorResponse.error;
      }
    } catch {
      // Use the generic message when the response does not contain JSON.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as UnlockResponse;
}
