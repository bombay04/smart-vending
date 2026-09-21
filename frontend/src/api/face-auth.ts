import { PI_UNLOCK_BASE_URL } from "../config/api";

export type FaceAuthenticationFailureStatus =
  | "NO_MATCH"
  | "NO_FACE"
  | "MULTIPLE_FACES"
  | "BUSY"
  | "UNAVAILABLE";

export interface FaceAuthenticationMatch {
  status: "MATCH";
  employeeCode: string;
  distance: number;
  threshold: number;
}

export class FaceAuthenticationError extends Error {
  constructor(readonly status: FaceAuthenticationFailureStatus) {
    super(status);
    this.name = "FaceAuthenticationError";
  }
}

const faceAuthenticationUrl = `${PI_UNLOCK_BASE_URL}/face/authenticate`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function requestFaceAuthentication(
  signal?: AbortSignal,
): Promise<FaceAuthenticationMatch> {
  const response = await fetch(faceAuthenticationUrl, {
    method: "POST",
    signal,
  });
  const responseData = await readJson(response);

  if (response.ok) {
    if (
      response.status === 200 &&
      isRecord(responseData) &&
      responseData.status === "MATCH" &&
      typeof responseData.employeeCode === "string" &&
      responseData.employeeCode.trim().length > 0 &&
      typeof responseData.distance === "number" &&
      Number.isFinite(responseData.distance) &&
      typeof responseData.threshold === "number" &&
      Number.isFinite(responseData.threshold)
    ) {
      return {
        status: "MATCH",
        employeeCode: responseData.employeeCode,
        distance: responseData.distance,
        threshold: responseData.threshold,
      };
    }

    throw new FaceAuthenticationError("UNAVAILABLE");
  }

  if (isRecord(responseData)) {
    const status = responseData.status;
    if (response.status === 401 && status === "NO_MATCH") {
      throw new FaceAuthenticationError("NO_MATCH");
    }
    if (
      response.status === 422 &&
      (status === "NO_FACE" || status === "MULTIPLE_FACES")
    ) {
      throw new FaceAuthenticationError(status);
    }
    if (response.status === 409 && status === "BUSY") {
      throw new FaceAuthenticationError("BUSY");
    }
    if (response.status === 503 && status === "UNAVAILABLE") {
      throw new FaceAuthenticationError("UNAVAILABLE");
    }
  }

  throw new FaceAuthenticationError("UNAVAILABLE");
}
