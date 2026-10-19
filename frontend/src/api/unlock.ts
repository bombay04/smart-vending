import { PI_UNLOCK_BASE_URL } from "../config/api";
import type {
  RestockUnlockResponse,
  UnlockRequest,
  UnlockResponse,
} from "../types/unlock";
import { API_BASE_URL } from "../config/api";

const unlockUrl = `${PI_UNLOCK_BASE_URL}/unlock`;
const restockGrantUrl = `${API_BASE_URL}/api/v1/restocks/unlock-grant`;
const restockUnlockUrl = `${PI_UNLOCK_BASE_URL}/restock/unlock`;

export async function unlockSlot(
  slotNumber: number,
  transactionId: number,
): Promise<UnlockResponse> {
  const requestBody: UnlockRequest = { slotNumber, transactionId };
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

async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string") return new Error(payload.error);
  } catch {
    // Use the safe localized fallback below.
  }
  return new Error(fallback);
}

export async function unlockRestockSlot(
  sessionId: number,
  slotNumber: number,
  faceAuthorization: string,
  signal?: AbortSignal,
): Promise<RestockUnlockResponse> {
  let grantResponse: Response;
  try {
    grantResponse = await fetch(restockGrantUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, slotNumber, faceAuthorization }),
      signal,
    });
  } catch {
    throw new Error(
      "ไม่สามารถยืนยันสิทธิ์เปิดช่องได้ กรุณาตรวจสอบการเชื่อมต่อ",
    );
  }
  if (!grantResponse.ok) {
    throw await responseError(
      grantResponse,
      "ไม่สามารถยืนยันสิทธิ์เปิดช่องได้",
    );
  }
  const grantPayload = (await grantResponse.json()) as {
    data?: { authorization?: unknown };
  };
  const authorization = grantPayload.data?.authorization;
  if (typeof authorization !== "string" || authorization.length === 0) {
    throw new Error("ไม่สามารถยืนยันสิทธิ์เปิดช่องได้");
  }

  let response: Response;
  try {
    response = await fetch(restockUnlockUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotNumber, authorization }),
      signal,
    });
  } catch {
    throw new Error("ไม่สามารถเชื่อมต่ออุปกรณ์เปิดช่องได้ กรุณาติดต่อผู้ดูแล");
  }
  if (!response.ok) {
    if (response.status === 503) {
      throw new Error("ไม่สามารถอ่านสถานะฝาตู้ได้ กรุณาติดต่อผู้ดูแล");
    }
    if (response.status === 409) {
      throw new Error(
        "ช่องเปิดอยู่แล้ว หรือยังรอให้เปิดและปิดฝาตู้จากคำสั่งก่อนหน้า",
      );
    }
    throw await responseError(response, "เปิดช่องไม่สำเร็จ กรุณาลองใหม่");
  }
  return (await response.json()) as RestockUnlockResponse;
}
