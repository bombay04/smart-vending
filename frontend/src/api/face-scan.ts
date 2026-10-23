import { PI_UNLOCK_BASE_URL } from "../config/api";

export type FaceScanState =
  | "CAMERA_STARTING"
  | "POSITION_FACE"
  | "FACE_DETECTED"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "RETURN_CENTER"
  | "VERIFYING"
  | "SUCCESS"
  | "ERROR"
  | "CANCELLED";

export interface FaceScanStatus {
  state: FaceScanState;
  challenge: "TURN_LEFT" | "TURN_RIGHT" | null;
  progress: number;
  required: number;
  previewReady: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createFaceScanId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const random = crypto.getRandomValues(new Uint32Array(4));
  return Array.from(random, (value) => value.toString(16).padStart(8, "0")).join("");
}

export async function fetchFaceScanStatus(
  scanId: string,
  signal?: AbortSignal,
): Promise<FaceScanStatus | null> {
  const response = await fetch(
    `${PI_UNLOCK_BASE_URL}/face/scan/status?scanId=${encodeURIComponent(scanId)}`,
    { cache: "no-store", signal },
  );
  if (response.status === 404) return null;
  const payload = (await response.json()) as unknown;
  if (!response.ok || !isRecord(payload) || payload.status !== "OK") {
    throw new Error("Face scan status is unavailable.");
  }
  const state = payload.state;
  const challenge = payload.challenge;
  if (
    typeof state !== "string" ||
    (challenge !== null && challenge !== "TURN_LEFT" && challenge !== "TURN_RIGHT") ||
    typeof payload.progress !== "number" ||
    typeof payload.required !== "number" ||
    typeof payload.previewReady !== "boolean"
  ) {
    throw new Error("Face scan status response is invalid.");
  }
  return payload as unknown as FaceScanStatus;
}

export function faceScanPreviewUrl(scanId: string, revision: number): string {
  return `${PI_UNLOCK_BASE_URL}/face/scan/preview?scanId=${encodeURIComponent(scanId)}&v=${revision}`;
}

export async function cancelFaceScan(scanId: string): Promise<void> {
  try {
    await fetch(`${PI_UNLOCK_BASE_URL}/face/scan/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId }),
      keepalive: true,
    });
  } catch {
    // The server has its own bounded timeout and will release the camera.
  }
}
