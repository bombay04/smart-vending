import { PI_UNLOCK_BASE_URL } from "../config/api";

export type FaceRegistrationFailureStatus =
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "ALREADY_REGISTERED"
  | "BUSY"
  | "UNAVAILABLE";

export interface FaceRegistrationSuccess {
  status: "REGISTERED";
  employeeCode: string;
}

export class FaceRegistrationError extends Error {
  constructor(readonly status: FaceRegistrationFailureStatus) {
    super(status);
    this.name = "FaceRegistrationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function registerEmployeeFace(
  employeeCode: string,
  signal?: AbortSignal,
): Promise<FaceRegistrationSuccess> {
  const normalizedEmployeeCode = employeeCode.trim().toUpperCase();
  const response = await fetch(`${PI_UNLOCK_BASE_URL}/face/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeCode: normalizedEmployeeCode }),
    signal,
  });

  let responseData: unknown;
  try {
    responseData = (await response.json()) as unknown;
  } catch {
    throw new FaceRegistrationError("UNAVAILABLE");
  }

  if (
    response.status === 200 &&
    response.ok &&
    isRecord(responseData) &&
    responseData.status === "REGISTERED" &&
    responseData.employeeCode === normalizedEmployeeCode
  ) {
    return { status: "REGISTERED", employeeCode: normalizedEmployeeCode };
  }

  if (isRecord(responseData)) {
    if (
      response.status === 422 &&
      (responseData.status === "NO_FACE" || responseData.status === "MULTIPLE_FACES")
    ) {
      throw new FaceRegistrationError(responseData.status);
    }
    if (
      response.status === 409 &&
      (responseData.status === "ALREADY_REGISTERED" || responseData.status === "BUSY")
    ) {
      throw new FaceRegistrationError(responseData.status);
    }
    if (response.status === 503 && responseData.status === "UNAVAILABLE") {
      throw new FaceRegistrationError("UNAVAILABLE");
    }
  }

  throw new FaceRegistrationError("UNAVAILABLE");
}
